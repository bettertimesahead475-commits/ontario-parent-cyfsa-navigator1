// Stage 9D-4B-2A-i — hardened, read-only ZIP/OOXML container reader.
//
// SCOPE: this module does ONE job — safely open a .docx (which is a ZIP/OOXML package) and
// return the raw bytes of the parts an inventory pass needs (word/document.xml, word/settings.xml,
// [Content_Types].xml). It never writes/modifies the source bytes, never executes macros, never
// follows external relationships, and never resolves XML entities.
//
// It is intentionally NOT a general-purpose ZIP library: no compression, no writing, no support
// for split/spanned archives, no ZIP64 (real Office-produced .docx files this small never need
// ZIP64; a ZIP64 EOCD locator is treated as unsupported and rejected rather than guessed at).
//
// Threat model addressed here (this parser gets its own safety review — it does not inherit
// safety from Stage 9D-4B-1's shallower magic-bytes/substring DOCX signature check):
//   - Zip-slip / path traversal: entry names containing "..", a leading "/", a drive letter, or
//     backslashes are rejected outright rather than "sanitized" (sanitizing invites bypass bugs;
//     rejection is unambiguous since this reader never writes to disk anyway).
//   - Decompression ("zip") bombs: every entry's declared uncompressed size is capped, the sum of
//     all entries' declared uncompressed sizes is capped, the compression ratio is capped, and the
//     actual inflate call is bounded with zlib's `maxOutputLength` so a mismatched/lying header
//     cannot produce unbounded memory use.
//   - Malformed / adversarial archives: entry counts are capped, the End Of Central Directory is
//     located and validated (not merely assumed at EOF-first-match), unsupported compression
//     methods are rejected, and any structural inconsistency throws rather than best-effort-parses.
//   - No external entity / relationship following: this reader never resolves XML entities and
//     never fetches anything from a URI found inside a part; it only returns bytes for the caller
//     to scan with regex/string operations (see docxFieldInventory.ts), never a general XML DOM
//     parser with DTD support. Any DOCTYPE/ENTITY declaration found in a returned XML part is
//     flagged by the caller (belt-and-suspenders) rather than trusted.
import zlib from "node:zlib";

export class DocxSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DocxSafetyError";
  }
}

function fail(code: string, message: string): never {
  throw new DocxSafetyError(code, message);
}

// --- Safety bounds -----------------------------------------------------------------------
export const ZIP_SAFETY_LIMITS = {
  /** A real Office .docx has well under a few hundred parts. */
  maxEntries: 2000,
  /** Per-entry uncompressed size cap (64 MiB — generous for a form template part). */
  maxEntryUncompressedBytes: 64 * 1024 * 1024,
  /** Sum of all entries' declared uncompressed sizes. */
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  /** Reject an entry whose declared expansion ratio looks like a bomb. */
  maxCompressionRatio: 300,
  /** Absolute cap passed to zlib so a lying header can't over-allocate regardless. */
  maxInflateOutputBytes: 64 * 1024 * 1024
} as const;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;

export interface ZipEntryMeta {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface SafeDocxPackage {
  /** Entry name -> raw (already-inflated) bytes. Only entries requested via `wantedEntries` are inflated. */
  parts: Map<string, Buffer>;
  /** All entry names found in the central directory (for reporting/anomaly detection only). */
  allEntryNames: string[];
}

function isTraversalUnsafe(name: string): boolean {
  if (name.length === 0) return true;
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (/^[a-zA-Z]:/.test(name)) return true; // drive-letter absolute path
  const normalized = name.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some(seg => seg === "..")) return true;
  if (normalized.includes("\0")) return true;
  return false;
}

/** Locate the End Of Central Directory record, scanning from the end (bounded, not unbounded). */
function findEocd(buf: Buffer): number {
  const maxCommentLength = 65535;
  const minEocdSize = 22;
  const searchStart = Math.max(0, buf.length - minEocdSize - maxCommentLength);
  for (let i = buf.length - minEocdSize; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return -1;
}

/** Parses the central directory into entry metadata, and enforces structural bounds. */
function readCentralDirectory(buf: Buffer): ZipEntryMeta[] {
  const eocdOffset = findEocd(buf);
  if (eocdOffset === -1) {
    fail("EOCD_NOT_FOUND", "Not a valid ZIP: End Of Central Directory record not found.");
  }

  // Reject ZIP64 rather than guess: check for a ZIP64 EOCD locator immediately before EOCD.
  if (eocdOffset >= 20 && buf.readUInt32LE(eocdOffset - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    fail("ZIP64_UNSUPPORTED", "ZIP64 archives are not supported by this reader (unexpected for a real .docx of this size).");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buf.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
  const commentLength = buf.readUInt16LE(eocdOffset + 20);

  if (eocdOffset + 22 + commentLength !== buf.length) {
    fail("EOCD_TRAILING_DATA", "Trailing/garbage data after the ZIP comment (structural inconsistency).");
  }
  if (totalEntries > ZIP_SAFETY_LIMITS.maxEntries) {
    fail("TOO_MANY_ENTRIES", `Archive declares ${totalEntries} entries, exceeding the safety cap of ${ZIP_SAFETY_LIMITS.maxEntries}.`);
  }
  if (centralDirOffset + centralDirSize > buf.length) {
    fail("CENTRAL_DIR_OUT_OF_BOUNDS", "Central directory extends past end of file.");
  }

  const entries: ZipEntryMeta[] = [];
  let pos = centralDirOffset;
  const centralDirEnd = centralDirOffset + centralDirSize;

  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > centralDirEnd) {
      fail("CENTRAL_DIR_TRUNCATED", "Central directory record truncated (fewer entries than declared).");
    }
    const sig = buf.readUInt32LE(pos);
    if (sig !== CENTRAL_DIR_SIGNATURE) {
      fail("CENTRAL_DIR_BAD_SIGNATURE", `Central directory entry ${i} has an invalid signature.`);
    }
    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);

    const nameStart = pos + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > centralDirEnd) {
      fail("CENTRAL_DIR_TRUNCATED", `Central directory entry ${i} name extends past directory bounds.`);
    }
    const rawName = buf.subarray(nameStart, nameEnd).toString("utf8");

    if (isTraversalUnsafe(rawName)) {
      fail("ZIP_SLIP_REJECTED", `Rejected entry with unsafe/traversal path: "${rawName}".`);
    }
    if (uncompressedSize > ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes) {
      fail("ENTRY_TOO_LARGE", `Entry "${rawName}" declares ${uncompressedSize} uncompressed bytes, exceeding per-entry cap.`);
    }
    if (compressedSize > 0) {
      const ratio = uncompressedSize / compressedSize;
      if (ratio > ZIP_SAFETY_LIMITS.maxCompressionRatio) {
        fail("SUSPICIOUS_COMPRESSION_RATIO", `Entry "${rawName}" has an implausible compression ratio (${ratio.toFixed(1)}x) — possible zip bomb.`);
      }
    }

    entries.push({ name: rawName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    pos = nameEnd + extraLength + commentLen;
  }

  const totalUncompressed = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (totalUncompressed > ZIP_SAFETY_LIMITS.maxTotalUncompressedBytes) {
    fail("TOTAL_SIZE_TOO_LARGE", `Sum of declared uncompressed sizes (${totalUncompressed}) exceeds the safety cap.`);
  }

  return entries;
}

/** Reads and inflates one entry given its central-directory metadata, from the local header. */
function readEntryData(buf: Buffer, meta: ZipEntryMeta): Buffer {
  const lh = meta.localHeaderOffset;
  if (lh + 30 > buf.length) {
    fail("LOCAL_HEADER_OUT_OF_BOUNDS", `Local header for "${meta.name}" is out of bounds.`);
  }
  if (buf.readUInt32LE(lh) !== LOCAL_FILE_SIGNATURE) {
    fail("LOCAL_HEADER_BAD_SIGNATURE", `Local header for "${meta.name}" has an invalid signature.`);
  }
  const nameLength = buf.readUInt16LE(lh + 26);
  const extraLength = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLength + extraLength;
  const dataEnd = dataStart + meta.compressedSize;
  if (dataEnd > buf.length) {
    fail("ENTRY_DATA_OUT_OF_BOUNDS", `Entry data for "${meta.name}" extends past end of file.`);
  }
  const compressed = buf.subarray(dataStart, dataEnd);

  if (meta.compressionMethod === 0) {
    // Stored (no compression).
    if (compressed.length !== meta.uncompressedSize) {
      fail("STORED_SIZE_MISMATCH", `Entry "${meta.name}" is stored but compressed/uncompressed sizes disagree.`);
    }
    return Buffer.from(compressed);
  }
  if (meta.compressionMethod !== 8) {
    fail("UNSUPPORTED_COMPRESSION", `Entry "${meta.name}" uses unsupported compression method ${meta.compressionMethod} (only stored/deflate are accepted).`);
  }

  try {
    const out = zlib.inflateRawSync(compressed, {
      maxOutputLength: Math.min(ZIP_SAFETY_LIMITS.maxInflateOutputBytes, ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes)
    });
    if (out.length !== meta.uncompressedSize) {
      fail("INFLATE_SIZE_MISMATCH", `Entry "${meta.name}" inflated to ${out.length} bytes, expected ${meta.uncompressedSize}.`);
    }
    return out;
  } catch (err) {
    if (err instanceof DocxSafetyError) throw err;
    fail("INFLATE_FAILED", `Failed to inflate entry "${meta.name}": ${(err as Error).message}`);
  }
}

/**
 * Safely opens a DOCX (ZIP/OOXML) buffer and inflates only the requested part names.
 * Throws DocxSafetyError on any structural anomaly, traversal attempt, or bomb-shaped input.
 */
export function openDocxSafely(bytes: Buffer, wantedEntries: readonly string[]): SafeDocxPackage {
  if (bytes.length < 22) {
    fail("TOO_SMALL", "File is too small to be a ZIP archive.");
  }
  const entries = readCentralDirectory(bytes);
  const wanted = new Set(wantedEntries);
  const parts = new Map<string, Buffer>();

  for (const entry of entries) {
    if (wanted.has(entry.name)) {
      parts.set(entry.name, readEntryData(bytes, entry));
    }
  }

  return { parts, allEntryNames: entries.map(e => e.name) };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — DOCX text extraction (OOXML / WordprocessingML).
 *
 * Reads the Word parts with a real XML parser and keeps the order the author wrote: body paragraphs and tables
 * in sequence, with text boxes placed after the paragraph that holds them. Headers, footers, footnotes, endnotes
 * and document metadata are included and labelled, so a parent or professional can see where each piece came from.
 *
 * Anything that is not text is reported, never silently dropped: embedded images, charts and embedded objects set
 * `complete` to false and are listed in `notes`. Tracked deletions are excluded from the text and counted.
 *
 * Safety: archive handling is delegated to openDocxSafely (docxZipSafe.ts), which bounds entry count, sizes and
 * compression ratios. XML document type declarations are refused outright. Office files never contain one, and
 * entity declarations are the usual route to entity-expansion attacks.
 */

import { XMLParser } from "fast-xml-parser";
import { openDocxSafely, DocxSafetyError } from "./docxZipSafe.js";

export type DocxBlockKind = "body" | "table" | "textbox" | "header" | "footer" | "footnote" | "endnote";

export interface DocxBlock {
  kind: DocxBlockKind;
  /** Plain text of the block. Table blocks have one row per line, cells separated by " | ". */
  text: string;
  /** Present for tables: the cell text of each row, for structured review. */
  rows?: string[][];
}

export interface DocxImageReference {
  /** The package part that references the image, e.g. word/document.xml. */
  part: string;
  /** The media part the relationship points to, e.g. word/media/image1.png. */
  target: string;
}

export interface DocxExtraction {
  /** All blocks in document order, joined with blank lines. Non-body blocks carry a label such as "[Header]". */
  text: string;
  blocks: DocxBlock[];
  /** Metadata that helps identify a document (title, author, dates, declared page count). */
  metadata: Record<string, string>;
  images: DocxImageReference[];
  /** Number of tracked deletions. Deleted text is excluded from `text`. */
  trackedDeletionsSkipped: number;
  /** False when any material content could not be read as text. Callers must not present such a result as complete. */
  complete: boolean;
  notes: string[];
}

const IMAGE_RELATIONSHIP_TYPE_SUFFIX = "/image";

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

type XmlNode = Record<string, any>;

function tagOf(node: XmlNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text");
}

function childrenOf(node: XmlNode): XmlNode[] {
  const tag = tagOf(node);
  return tag ? ((node[tag] as XmlNode[]) ?? []) : [];
}

function attrOf(node: XmlNode, name: string): string | undefined {
  const value = node[":@"]?.[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

function textOf(nodes: XmlNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node["#text"] !== undefined) out += String(node["#text"]);
  }
  return out;
}

function namedChildren(nodes: XmlNode[], tag: string): XmlNode[] {
  return nodes.filter((node) => tagOf(node) === tag);
}

/** Depth-first search for every element with one of the given tags. */
function findAll(nodes: XmlNode[], tags: readonly string[], out: XmlNode[] = []): XmlNode[] {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    if (tags.includes(tag)) out.push(node);
    findAll(childrenOf(node), tags, out);
  }
  return out;
}

function parseXml(xml: string, part: string): XmlNode[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new DocxSafetyError("DTD_FORBIDDEN", `${part} contains an XML document type declaration, which Word files do not use.`);
  }
  try {
    return parser.parse(xml) as XmlNode[];
  } catch {
    throw new DocxSafetyError("XML_INVALID", `${part} is not well-formed XML.`);
  }
}

function rootElement(parsed: XmlNode[], expectedTag: string, part: string): XmlNode {
  const root = parsed.find((node) => tagOf(node) === expectedTag);
  if (!root) throw new Error(`Invalid DOCX package: ${part} has no ${expectedTag} element.`);
  return root;
}

interface InlineState {
  text: string;
  imageRelIds: string[];
  chartsOrObjects: number;
  textboxes: XmlNode[][];
  deletions: number;
}

const INLINE_CONTAINERS = new Set([
  "w:r", "w:ins", "w:hyperlink", "w:fldSimple", "w:smartTag", "w:customXml", "w:sdt", "w:sdtContent",
]);

/** Collects run-level text. Text boxes and images are recorded for the caller to place. */
function collectInline(nodes: XmlNode[], state: InlineState): void {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    if (INLINE_CONTAINERS.has(tag)) {
      collectInline(childrenOf(node), state);
      continue;
    }
    switch (tag) {
      case "w:t":
        state.text += textOf(childrenOf(node));
        break;
      case "w:tab":
        state.text += "\t";
        break;
      case "w:br":
      case "w:cr":
        state.text += "\n";
        break;
      case "w:noBreakHyphen":
        state.text += "-";
        break;
      case "w:footnoteReference":
        state.text += `[footnote ${attrOf(node, "w:id") ?? ""}]`;
        break;
      case "w:endnoteReference":
        state.text += `[endnote ${attrOf(node, "w:id") ?? ""}]`;
        break;
      case "w:del":
        // Tracked deletions are counted and excluded: the text is the accepted wording without them.
        state.deletions++;
        break;
      case "mc:AlternateContent": {
        // Word stores a drawing twice: a modern Choice and a legacy Fallback. Reading both duplicates text.
        const alternates = childrenOf(node);
        const choices = namedChildren(alternates, "mc:Choice");
        const chosen = choices.length > 0 ? choices : namedChildren(alternates, "mc:Fallback");
        for (const choice of chosen) collectInline(childrenOf(choice), state);
        break;
      }
      case "w:drawing":
      case "w:pict":
      case "w:object":
        collectDrawing(node, state);
        break;
      default:
        // Run and paragraph properties, field instructions and other non-text elements are skipped by design.
        break;
    }
  }
}

function collectDrawing(node: XmlNode, state: InlineState): void {
  const inside = childrenOf(node);
  for (const blip of findAll(inside, ["a:blip"])) {
    const rId = attrOf(blip, "r:embed");
    if (rId) state.imageRelIds.push(rId);
  }
  for (const imagedata of findAll(inside, ["v:imagedata"])) {
    const rId = attrOf(imagedata, "r:id");
    if (rId) state.imageRelIds.push(rId);
  }
  for (const txbx of findAll(inside, ["w:txbxContent"])) {
    state.textboxes.push(childrenOf(txbx));
  }
  if (findAll(inside, ["c:chart", "o:OLEObject"]).length > 0 || tagOf(node) === "w:object") {
    state.chartsOrObjects++;
  }
}

interface Context {
  images: string[];
  chartsOrObjects: number;
  deletions: number;
}

function newContext(): Context {
  return { images: [], chartsOrObjects: 0, deletions: 0 };
}

function paragraphText(paragraph: XmlNode, ctx: Context): { text: string; textboxes: XmlNode[][] } {
  const state: InlineState = { text: "", imageRelIds: [], chartsOrObjects: 0, textboxes: [], deletions: 0 };
  collectInline(childrenOf(paragraph), state);
  ctx.images.push(...state.imageRelIds);
  ctx.chartsOrObjects += state.chartsOrObjects;
  ctx.deletions += state.deletions;
  return { text: state.text.trim(), textboxes: state.textboxes };
}

function tableRows(table: XmlNode, ctx: Context): string[][] {
  return namedChildren(childrenOf(table), "w:tr").map((row) =>
    namedChildren(childrenOf(row), "w:tc").map((cell) =>
      collectBlocks(childrenOf(cell), ctx, "body")
        .map((block) => block.text)
        .filter(Boolean)
        .join("\n")
    )
  );
}

/** Block-level content in order. Paragraphs and tables keep the author's sequence. */
function collectBlocks(nodes: XmlNode[], ctx: Context, kind: DocxBlockKind): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    if (tag === "w:p") {
      const { text, textboxes } = paragraphText(node, ctx);
      if (text) blocks.push({ kind, text });
      for (const boxNodes of textboxes) {
        blocks.push(...collectBlocks(boxNodes, ctx, "textbox"));
      }
    } else if (tag === "w:tbl") {
      const rows = tableRows(node, ctx).filter((row) => row.some((cell) => cell.trim().length > 0));
      if (rows.length > 0) {
        blocks.push({ kind: "table", text: rows.map((row) => row.join(" | ")).join("\n"), rows });
      }
    } else if (tag === "w:sdt") {
      for (const content of namedChildren(childrenOf(node), "w:sdtContent")) {
        blocks.push(...collectBlocks(childrenOf(content), ctx, kind));
      }
    } else if (tag === "mc:AlternateContent") {
      const alternates = childrenOf(node);
      const choices = namedChildren(alternates, "mc:Choice");
      const chosen = choices.length > 0 ? choices : namedChildren(alternates, "mc:Fallback");
      for (const choice of chosen) blocks.push(...collectBlocks(childrenOf(choice), ctx, kind));
    }
  }
  return blocks;
}

/** Image relationship ids for a part, resolved to package paths via word/_rels/<part>.rels. */
function relationshipTargets(parts: Map<string, Buffer>, partName: string): Map<string, string> {
  const slash = partName.lastIndexOf("/");
  const dir = partName.slice(0, slash);
  const base = partName.slice(slash + 1);
  const relsName = `${dir}/_rels/${base}.rels`;
  const map = new Map<string, string>();
  const relsBuf = parts.get(relsName);
  if (!relsBuf) return map;
  for (const rel of findAll(parseXml(relsBuf.toString("utf8"), relsName), ["Relationship"])) {
    const id = attrOf(rel, "Id");
    const target = attrOf(rel, "Target");
    const type = attrOf(rel, "Type") ?? "";
    if (!id || !target || !type.endsWith(IMAGE_RELATIONSHIP_TYPE_SUFFIX)) continue;
    map.set(id, target.startsWith("/") ? target.slice(1) : `${dir}/${target}`);
  }
  return map;
}

function coreMetadata(parts: Map<string, Buffer>): Record<string, string> {
  const metadata: Record<string, string> = {};
  const core = parts.get("docProps/core.xml");
  if (core) {
    const root = rootElement(parseXml(core.toString("utf8"), "docProps/core.xml"), "cp:coreProperties", "docProps/core.xml");
    const fields: Array<[string, string]> = [
      ["dc:title", "title"],
      ["dc:subject", "subject"],
      ["dc:creator", "author"],
      ["cp:lastModifiedBy", "lastModifiedBy"],
      ["dcterms:created", "created"],
      ["dcterms:modified", "modified"],
    ];
    for (const [tag, key] of fields) {
      const element = namedChildren(childrenOf(root), tag)[0];
      const value = element ? textOf(childrenOf(element)).trim() : "";
      if (value) metadata[key] = value;
    }
  }
  const app = parts.get("docProps/app.xml");
  if (app) {
    const pages = findAll(parseXml(app.toString("utf8"), "docProps/app.xml"), ["Pages"])[0];
    const declared = pages ? textOf(childrenOf(pages)).trim() : "";
    // Pagination depends on the renderer, so this is recorded as metadata only and never used as a page number.
    if (declared) metadata.declaredPageCount = declared;
  }
  return metadata;
}

function sortedParts(parts: Map<string, Buffer>, pattern: RegExp): string[] {
  const number = (name: string) => Number(/(\d*)\.xml$/.exec(name)?.[1] || "1");
  return [...parts.keys()].filter((name) => pattern.test(name)).sort((a, b) => number(a) - number(b));
}

function addImages(
  ctx: Context,
  partName: string,
  parts: Map<string, Buffer>,
  out: DocxImageReference[],
  notes: string[]
): void {
  if (ctx.images.length === 0) return;
  const targets = relationshipTargets(parts, partName);
  for (const rId of ctx.images) {
    const target = targets.get(rId);
    if (!target) {
      notes.push(`An image reference (${rId}) in ${partName} has no matching relationship. Review that part manually.`);
      continue;
    }
    if (!out.some((ref) => ref.part === partName && ref.target === target)) out.push({ part: partName, target });
  }
  ctx.images.length = 0;
}

/** Full extraction with structure, metadata and completeness. Throws on an invalid or unsafe package. */
export function extractDocxDocument(bytes: Buffer): DocxExtraction {
  if (!bytes || bytes.length === 0) {
    throw new Error("Cannot extract DOCX from empty buffer.");
  }

  try {
    const listing = openDocxSafely(bytes, []);
    if (!listing.allEntryNames.includes("word/document.xml")) {
      throw new Error("Invalid DOCX package: word/document.xml not found.");
    }
    const wanted = listing.allEntryNames.filter(
      (name) =>
        name === "word/document.xml" ||
        name === "word/footnotes.xml" ||
        name === "word/endnotes.xml" ||
        name === "docProps/core.xml" ||
        name === "docProps/app.xml" ||
        /^word\/(header|footer)\d*\.xml$/.test(name) ||
        /^word\/_rels\/[^/]+\.rels$/.test(name)
    );
    const parts = openDocxSafely(bytes, wanted).parts;

    const docRoot = rootElement(parseXml(parts.get("word/document.xml")!.toString("utf8"), "word/document.xml"), "w:document", "word/document.xml");
    const bodyNode = namedChildren(childrenOf(docRoot), "w:body")[0];
    if (!bodyNode) throw new Error("Invalid DOCX package: word/document.xml has no body.");

    const notes: string[] = [];
    const images: DocxImageReference[] = [];
    const blocks: DocxBlock[] = [];
    const totals = { chartsOrObjects: 0, deletions: 0 };
    const absorb = (ctx: Context) => {
      totals.chartsOrObjects += ctx.chartsOrObjects;
      totals.deletions += ctx.deletions;
    };

    // Headers first. Word repeats them on every page; they are shown once, labelled.
    for (const name of sortedParts(parts, /^word\/header\d*\.xml$/)) {
      const root = rootElement(parseXml(parts.get(name)!.toString("utf8"), name), "w:hdr", name);
      const ctx = newContext();
      for (const block of collectBlocks(childrenOf(root), ctx, "header")) blocks.push({ ...block, text: `[Header] ${block.text}` });
      addImages(ctx, name, parts, images, notes);
      absorb(ctx);
    }

    // Body, in document order.
    const bodyCtx = newContext();
    blocks.push(...collectBlocks(childrenOf(bodyNode), bodyCtx, "body"));
    addImages(bodyCtx, "word/document.xml", parts, images, notes);
    absorb(bodyCtx);

    // Footnotes and endnotes. Separator entries (w:type present, or id <= 0) are structure, not content.
    const noteSets = [
      { part: "word/footnotes.xml", root: "w:footnotes", child: "w:footnote", kind: "footnote" as const, label: "Footnote" },
      { part: "word/endnotes.xml", root: "w:endnotes", child: "w:endnote", kind: "endnote" as const, label: "Endnote" },
    ];
    for (const set of noteSets) {
      const xml = parts.get(set.part);
      if (!xml) continue;
      const root = rootElement(parseXml(xml.toString("utf8"), set.part), set.root, set.part);
      const ctx = newContext();
      for (const note of namedChildren(childrenOf(root), set.child)) {
        const id = attrOf(note, "w:id") ?? "";
        if (attrOf(note, "w:type") !== undefined || Number(id) <= 0) continue;
        for (const block of collectBlocks(childrenOf(note), ctx, set.kind)) {
          blocks.push({ ...block, text: `[${set.label} ${id}] ${block.text}` });
        }
      }
      addImages(ctx, set.part, parts, images, notes);
      absorb(ctx);
    }

    // Footers last.
    for (const name of sortedParts(parts, /^word\/footer\d*\.xml$/)) {
      const root = rootElement(parseXml(parts.get(name)!.toString("utf8"), name), "w:ftr", name);
      const ctx = newContext();
      for (const block of collectBlocks(childrenOf(root), ctx, "footer")) blocks.push({ ...block, text: `[Footer] ${block.text}` });
      addImages(ctx, name, parts, images, notes);
      absorb(ctx);
    }

    if (totals.chartsOrObjects > 0) {
      notes.push(`${totals.chartsOrObjects} chart or embedded object(s) were found. Their contents were not read as text. Review them manually.`);
    }
    if (totals.deletions > 0) {
      notes.push(`${totals.deletions} tracked deletion(s) were excluded from the text. Deleted wording may matter, so check the revision history.`);
    }
    if (images.length > 0) {
      notes.push(`${images.length} embedded image(s) were found. Their contents were not read as text. Run OCR or review them manually.`);
    }

    const text = blocks.map((block) => block.text).filter(Boolean).join("\n\n");
    if (!text.trim() && images.length === 0) {
      // A package with no text and no images is not a readable document, so it must not analyze as empty evidence.
      throw new Error("No readable text was found in this DOCX file.");
    }

    return {
      text,
      blocks,
      metadata: coreMetadata(parts),
      images,
      trackedDeletionsSkipped: totals.deletions,
      complete: notes.length === 0,
      notes,
    };
  } catch (err: any) {
    if (err instanceof DocxSafetyError) {
      throw new Error(`DOCX security verification failed: ${err.message}`);
    }
    throw err;
  }
}

/** Plain text of a DOCX document in document order. Callers that need completeness use extractDocxDocument. */
export function extractTextFromDocx(bytes: Buffer): string {
  return extractDocxDocument(bytes).text;
}

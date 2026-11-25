import { describe, expect, it } from 'vitest';
import { detectType } from '../functions/api/_document-extraction';

// Minimal ISO BMFF headers: [size][ 'ftyp' ][ major brand ]...
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);

describe('HEIC/HEIF detection for server-side OCR (replaces the in-browser converter)', () => {
  it('detects HEIC and HEIF brands from the file bytes', () => {
    for (const b of ['heic', 'heix', 'hevc', 'heim']) expect(detectType(ftyp(b))).toEqual({ type: 'image', imageMime: 'image/heic' });
    for (const b of ['mif1', 'msf1']) expect(detectType(ftyp(b))).toEqual({ type: 'image', imageMime: 'image/heif' });
  });
  it('does not treat other ISO BMFF files (e.g. MP4 video) as images', () => {
    expect(detectType(ftyp('isom')).type).not.toBe('image');
    expect(detectType(ftyp('mp42')).type).not.toBe('image');
  });
});

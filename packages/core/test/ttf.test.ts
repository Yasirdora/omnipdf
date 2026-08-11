import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTtf, subsetTtf, glyphClosure } from '../src/fonts/ttf.js';

const fixturePath = fileURLToPath(new URL('./fixtures/Ubuntu-R.ttf', import.meta.url));
const fontBytes = new Uint8Array(readFileSync(fixturePath));

// Table-directory checksum per the TrueType spec (big-endian uint32 sum).
function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const padded = data.length + ((4 - (data.length % 4)) % 4);
  for (let i = 0; i < padded; i += 4) {
    const b0 = data[i] ?? 0, b1 = data[i + 1] ?? 0, b2 = data[i + 2] ?? 0, b3 = data[i + 3] ?? 0;
    sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0;
  }
  return sum >>> 0;
}

describe('parseTtf', () => {
  const font = parseTtf(fontBytes);

  it('parses head/hhea/OS2 metrics', () => {
    expect(font.unitsPerEm).toBe(1000);
    expect(font.numGlyphs).toBeGreaterThan(1000);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
    expect(font.bbox.xMax).toBeGreaterThan(font.bbox.xMin);
  });

  it('extracts names', () => {
    // This fixture is the 2010-era beta Ubuntu font: its nameID 6 is "Ubuntu".
    expect(font.postscriptName).toBe('Ubuntu');
    expect(font.familyName).toMatch(/Ubuntu/);
  });

  it('maps codepoints through cmap (format 4 or 12)', () => {
    expect([4, 12]).toContain(font.cmapFormat);
    expect(font.mapCodepoint(0x41)).toBeGreaterThan(0); // 'A'
    expect(font.mapCodepoint(0x20)).toBeGreaterThan(0); // space
    // Cyrillic and Greek coverage is the reason we embed this fixture
    expect(font.mapCodepoint(0x41f)).toBeGreaterThan(0); // 'П'
    expect(font.mapCodepoint(0x393)).toBeGreaterThan(0); // 'Γ'
    // not in font -> .notdef
    expect(font.mapCodepoint(0x10fffe)).toBe(0);
  });

  it('returns per-glyph advances and raw glyf data', () => {
    const gid = font.mapCodepoint(0x41);
    expect(font.advances[gid]).toBeGreaterThan(0);
    expect(font.glyphData(gid).length).toBeGreaterThan(0);
    // space glyph exists but may have empty outlines; advance must be set
    expect(font.advances[font.mapCodepoint(0x20)]).toBeGreaterThan(0);
  });

  it('rejects OTF/CFF and TTC with clear errors', () => {
    const otto = fontBytes.slice(); otto.set([0x4f, 0x54, 0x54, 0x4f]);
    expect(() => parseTtf(otto)).toThrow(/OTF\/CFF/);
    const ttc = fontBytes.slice(); ttc.set([0x74, 0x74, 0x63, 0x66]);
    expect(() => parseTtf(ttc)).toThrow(/TTC/);
  });
});

describe('glyphClosure', () => {
  const font = parseTtf(fontBytes);

  it('always includes .notdef (gid 0)', () => {
    expect(glyphClosure(font, [0x41]).has(0)).toBe(true);
  });

  it('pulls in composite components (accented letters)', () => {
    // 'Ä' (U+00C4) is typically a composite of 'A' + dieresis
    const closure = glyphClosure(font, [0xc4]);
    const gidA = font.mapCodepoint(0x41);
    expect(closure.has(font.mapCodepoint(0xc4))).toBe(true);
    expect(closure.has(gidA)).toBe(true);
  });

  it('skips codepoints absent from the cmap', () => {
    const closure = glyphClosure(font, [0x10fffe]);
    expect(closure.size).toBe(1); // only .notdef
  });
});

describe('subsetTtf', () => {
  const font = parseTtf(fontBytes);
  const cps = [0x20, 0x41, 0x42, 0x41f, 0x440, 0x393, 0xb5]; // Latin + Cyrillic + Greek + µ
  const { bytes, glyphs } = subsetTtf(font, cps);

  it('shrinks the font dramatically', () => {
    expect(bytes.length).toBeLessThan(fontBytes.length / 4);
  });

  it('preserves glyph ids and returns the cp->gid map', () => {
    for (const cp of cps) {
      expect(glyphs.get(cp)).toBe(font.mapCodepoint(cp));
    }
  });

  it('produces a re-parseable valid TTF', () => {
    const re = parseTtf(bytes);
    expect(re.unitsPerEm).toBe(font.unitsPerEm);
    expect(re.numGlyphs).toBe(font.numGlyphs);
    for (const cp of cps) expect(re.mapCodepoint(cp)).toBe(font.mapCodepoint(cp));
    // advances survive the subset
    expect(re.advances[re.mapCodepoint(0x41)]).toBe(font.advances[font.mapCodepoint(0x41)]);
  });

  it('writes correct table checksums and checkSumAdjustment', () => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = view.getUint16(4, false);
    let headOff = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!);
      const check = view.getUint32(rec + 4, false);
      const off = view.getUint32(rec + 8, false);
      const len = view.getUint32(rec + 12, false);
      const data = bytes.subarray(off, off + len);
      if (tag === 'head') { headOff = off; continue; } // head is special-cased below
      expect(tableChecksum(data)).toBe(check);
    }
    // Whole-file checksum must equal 0xB1B0AFBA when head.checkSumAdjustment is included
    expect(headOff).toBeGreaterThan(-1);
    expect(view.getUint32(headOff + 8, false)).not.toBe(0); // adjustment written back
    expect(tableChecksum(bytes)).toBe(0xb1b0afba);
  });

  it('is deterministic for identical input', () => {
    const again = subsetTtf(font, cps);
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true);
  });
});

/**
 * TrueType (sfnt, glyf-outline) parser and subsetter.
 *
 * Scope (per design v2 §4): TrueType outlines only — .ttf / TTC-first-font,
 * glyf table. OTF/CFF (.otf, CFF charstrings) is deliberately out of scope
 * and rejected with a clear error.
 *
 * Subsetting strategy: glyph IDs are NOT remapped (CID == original GID via
 * /CIDToGIDMap /Identity). Unused glyphs become zero-length loca ranges, so
 * the glyf table carries only used outlines. This is the simple, robust end
 * of subsetting — compaction can come later without changing the PDF layer.
 */

export interface TtfGlyph {
  advanceWidth: number;
}

export interface TtfFont {
  unitsPerEm: number;
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number };
  ascender: number;
  descender: number;
  capHeight: number; // OS/2 sCapHeight, else ascender
  italicAngle: number;
  numGlyphs: number;
  postscriptName: string;
  familyName: string;
  advances: Uint16Array; // hmtx advances, indexed by gid
  cmapFormat: 4 | 12;
  mapCodepoint(cp: number): number; // -> gid (0 = .notdef)
  glyphData(gid: number): Uint8Array; // raw glyf bytes (may be empty)
  table(tag: string): Uint8Array | undefined; // raw table data
}

const REQUIRED = ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap', 'name', 'post'];

class Reader {
  constructor(readonly bytes: Uint8Array, readonly view: DataView) {}
  u16(o: number): number { return this.view.getUint16(o, false); }
  i16(o: number): number { return this.view.getInt16(o, false); }
  u32(o: number): number { return this.view.getUint32(o, false); }
  i32(o: number): number { return this.view.getInt32(o, false); }
}

export function parseTtf(input: Uint8Array): TtfFont {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = new Reader(bytes, view);

  const sfnt = r.u32(0);
  if (sfnt === 0x4f54544f /* 'OTTO' */ || sfnt === 0x43464620 /* 'CFF ' */) {
    throw new Error('OTF/CFF fonts are not supported yet — OmniPDF v1 embeds TrueType (glyf) fonts only.');
  }
  if (sfnt === 0x74746366 /* 'ttcf' */) {
    throw new Error('TTC collections: pass a single extracted .ttf (collection support is on the roadmap).');
  }
  if (sfnt !== 0x00010000 && sfnt !== 0x74727565 /* 'true' */) {
    throw new Error(`Not a TrueType font (sfnt version 0x${sfnt.toString(16)})`);
  }

  const numTables = r.u16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec]!, bytes[rec + 1]!, bytes[rec + 2]!, bytes[rec + 3]!);
    tables.set(tag, { offset: r.u32(rec + 8), length: r.u32(rec + 12) });
  }
  for (const tag of REQUIRED) {
    if (!tables.has(tag)) throw new Error(`TTF missing required table "${tag}"`);
  }
  const table = (tag: string): Uint8Array | undefined => {
    const t = tables.get(tag);
    return t ? bytes.subarray(t.offset, t.offset + t.length) : undefined;
  };

  // --- head ---
  const head = tables.get('head')!;
  const hOff = head.offset;
  const unitsPerEm = r.u16(hOff + 18);
  const bbox = { xMin: r.i16(hOff + 36), yMin: r.i16(hOff + 38), xMax: r.i16(hOff + 40), yMax: r.i16(hOff + 42) };
  const indexToLocFormat = r.i16(hOff + 50);

  // --- hhea / maxp ---
  const hhOff = tables.get('hhea')!.offset;
  const ascender = r.i16(hhOff + 4);
  const descender = r.i16(hhOff + 6);
  const numberOfHMetrics = r.u16(hhOff + 34);
  const numGlyphs = r.u16(tables.get('maxp')!.offset + 4);

  // --- hmtx ---
  const hmtxOff = tables.get('hmtx')!.offset;
  const advances = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    advances[g] = g < numberOfHMetrics
      ? r.u16(hmtxOff + g * 4)
      : r.u16(hmtxOff + (numberOfHMetrics - 1) * 4);
  }

  // --- loca / glyf ---
  const locaOff = tables.get('loca')!.offset;
  const glyfOff = tables.get('glyf')!.offset;
  const locaAt = (g: number): number =>
    indexToLocFormat === 0 ? r.u16(locaOff + g * 2) * 2 : r.u32(locaOff + g * 4);
  const glyphData = (gid: number): Uint8Array => {
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    return bytes.subarray(glyfOff + start, glyfOff + end);
  };

  // --- post ---
  const postOff = tables.get('post')!.offset;
  const italicAngle = r.i32(postOff + 4) / 65536;

  // --- OS/2 (optional) ---
  let capHeight = ascender;
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 96) {
    const version = r.u16(os2.offset);
    if (version >= 2) {
      const sCap = r.i16(os2.offset + 88);
      if (sCap > 0) capHeight = sCap;
    }
  }

  // --- name (IDs 6 PostScript, 1 family; prefer Windows/Unicode) ---
  const { postscriptName, familyName } = parseNames(bytes, tables.get('name')!, r);

  // --- cmap ---
  const cmap = parseCmap(bytes, tables.get('cmap')!, r);

  return {
    unitsPerEm, bbox, ascender, descender, capHeight, italicAngle,
    numGlyphs, postscriptName, familyName, advances,
    cmapFormat: cmap.format,
    mapCodepoint: cmap.map,
    glyphData,
    table,
  };
}

// ---------------------------------------------------------------------------
// name table
// ---------------------------------------------------------------------------

function parseNames(bytes: Uint8Array, t: { offset: number; length: number }, r: Reader) {
  const count = r.u16(t.offset + 2);
  const storage = t.offset + r.u16(t.offset + 4);
  let ps = '';
  let family = '';
  for (let i = 0; i < count; i++) {
    const rec = t.offset + 6 + i * 12;
    const platform = r.u16(rec);
    const nameId = r.u16(rec + 6);
    if (nameId !== 1 && nameId !== 6) continue;
    const len = r.u16(rec + 8);
    const off = storage + r.u16(rec + 10);
    let s = '';
    if (platform === 3 || platform === 0) {
      for (let j = 0; j < len; j += 2) s += String.fromCharCode((bytes[off + j]! << 8) | bytes[off + j + 1]!);
    } else {
      for (let j = 0; j < len; j++) s += String.fromCharCode(bytes[off + j]!);
    }
    if (nameId === 6 && !ps) ps = s;
    if (nameId === 1 && !family) family = s;
  }
  return {
    postscriptName: ps || family.replace(/\s+/g, '') || 'Font',
    familyName: family || ps || 'Font',
  };
}

// ---------------------------------------------------------------------------
// cmap — formats 4 and 12
// ---------------------------------------------------------------------------

interface CmapImpl {
  format: 4 | 12;
  map(cp: number): number;
}

function parseCmap(bytes: Uint8Array, t: { offset: number; length: number }, r: Reader): CmapImpl {
  const numSub = r.u16(t.offset + 2);
  let best4: number | undefined;
  let best12: number | undefined;
  for (let i = 0; i < numSub; i++) {
    const rec = t.offset + 4 + i * 8;
    const platform = r.u16(rec);
    const encoding = r.u16(rec + 2);
    const subOff = t.offset + r.u32(rec + 4);
    const format = r.u16(subOff);
    if (format === 12 && (platform === 3 || platform === 0)) best12 ??= subOff;
    if (format === 4 && (platform === 3 || platform === 0) && encoding !== 10) best4 ??= subOff;
  }
  if (best12 !== undefined) return { format: 12, map: makeCmap12(r, best12) };
  if (best4 !== undefined) return { format: 4, map: makeCmap4(r, best4) };
  throw new Error('TTF has no usable cmap (need format 4 or 12, Unicode or Windows)');
}

function makeCmap12(r: Reader, off: number): (cp: number) => number {
  const nGroups = r.u32(off + 12);
  const groupsOff = off + 16;
  return (cp) => {
    // binary search over sorted groups
    let lo = 0;
    let hi = nGroups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const g = groupsOff + mid * 12;
      const start = r.u32(g);
      const end = r.u32(g + 4);
      if (cp < start) hi = mid - 1;
      else if (cp > end) lo = mid + 1;
      else return r.u32(g + 8) + (cp - start);
    }
    return 0;
  };
}

function makeCmap4(r: Reader, off: number): (cp: number) => number {
  const segCount = r.u16(off + 6) / 2;
  const endCodes = off + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segCount; s++) {
      const end = r.u16(endCodes + s * 2);
      if (cp > end) continue;
      const start = r.u16(startCodes + s * 2);
      if (cp < start) return 0;
      const delta = r.i16(idDeltas + s * 2);
      const ro = r.u16(idRangeOffsets + s * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const glyphIndexAddr = idRangeOffsets + s * 2 + ro + (cp - start) * 2;
      const gid = r.u16(glyphIndexAddr);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };
}

// ---------------------------------------------------------------------------
// subsetting
// ---------------------------------------------------------------------------

export interface SubsetResult {
  bytes: Uint8Array;
  /** codepoint -> glyph id used in this subset (always includes mapping for input cps with nonzero gid). */
  glyphs: Map<number, number>;
}

const COMPOSITE_FLAGS = { ARG_WORDS: 0x0001, MORE_COMPONENTS: 0x0020, SCALE: 0x0008, XY_SCALE: 0x0040, TWO_BY_TWO: 0x0080 };

/** Resolve the full glyph closure (composite components included) for used codepoints. */
export function glyphClosure(font: TtfFont, codepoints: Iterable<number>): Set<number> {
  const gids = new Set<number>([0]); // .notdef always included
  const queue: number[] = [];
  for (const cp of codepoints) {
    const gid = font.mapCodepoint(cp);
    if (gid !== 0 && !gids.has(gid)) {
      gids.add(gid);
      queue.push(gid);
    }
  }
  while (queue.length) {
    const gid = queue.pop()!;
    const data = font.glyphData(gid);
    if (data.length < 10) continue;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getInt16(0, false) !== -1) continue; // simple glyph: no components
    let o = 10;
    let flags: number;
    do {
      flags = view.getUint16(o, false);
      const componentGid = view.getUint16(o + 2, false);
      if (!gids.has(componentGid)) {
        gids.add(componentGid);
        queue.push(componentGid);
      }
      o += 4;
      o += flags & COMPOSITE_FLAGS.ARG_WORDS ? 4 : 2;
      if (flags & COMPOSITE_FLAGS.SCALE) o += 2;
      else if (flags & COMPOSITE_FLAGS.XY_SCALE) o += 4;
      else if (flags & COMPOSITE_FLAGS.TWO_BY_TWO) o += 8;
    } while (flags & COMPOSITE_FLAGS.MORE_COMPONENTS);
  }
  return gids;
}

const KEEP_TABLES = ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap', 'name', 'post', 'OS/2', 'prep', 'fpgm', 'cvt ', 'gasp'];

/** Build a subsetted TTF containing only the given glyphs. GIDs are preserved. */
export function subsetTtf(font: TtfFont, codepoints: Iterable<number>): SubsetResult {
  const gids = glyphClosure(font, codepoints);
  const glyphMap = new Map<number, number>();
  for (const cp of codepoints) {
    const gid = font.mapCodepoint(cp);
    if (gid !== 0) glyphMap.set(cp, gid);
  }

  // --- rebuild glyf + loca (long format) ---
  const glyfParts: Uint8Array[] = [];
  const loca = new Uint32Array(font.numGlyphs + 1);
  let glyfLen = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    loca[g] = glyfLen;
    if (gids.has(g)) {
      const data = font.glyphData(g);
      glyfParts.push(data);
      glyfLen += data.length;
      // pad to 4-byte boundary
      const pad = (4 - (glyfLen % 4)) % 4;
      if (pad) {
        glyfParts.push(new Uint8Array(pad));
        glyfLen += pad;
      }
    }
  }
  loca[font.numGlyphs] = glyfLen;
  const glyfTable = concat(glyfParts);
  const locaTable = new Uint8Array(loca.length * 4);
  const locaView = new DataView(locaTable.buffer);
  loca.forEach((v, i) => locaView.setUint32(i * 4, v, false));

  // --- head: long loca, zero checksum adjustment (fixed after assembly) ---
  const headTable = new Uint8Array(font.table('head')!);
  const headView = new DataView(headTable.buffer);
  headView.setUint32(8, 0, false); // checkSumAdjustment = 0 for now
  headView.setInt16(50, 1, false); // indexToLocFormat = long

  const out: Array<[string, Uint8Array]> = [];
  for (const tag of KEEP_TABLES) {
    if (tag === 'head') out.push([tag, headTable]);
    else if (tag === 'loca') out.push([tag, locaTable]);
    else if (tag === 'glyf') out.push([tag, glyfTable]);
    else {
      const t = font.table(tag);
      if (t) out.push([tag, t]);
    }
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const bytes = assembleSfnt(out);
  return { bytes, glyphs: glyphMap };
}

/** Serialize sfnt with correct table checksums and checkSumAdjustment. */
function assembleSfnt(tables: Array<[string, Uint8Array]>): Uint8Array {
  const numTables = tables.length;
  const maxPow2 = 2 ** Math.floor(Math.log2(numTables));
  const searchRange = maxPow2 * 16;
  const entrySelector = Math.log2(maxPow2);
  const rangeShift = numTables * 16 - searchRange;

  const headerLen = 12 + numTables * 16;
  let offset = headerLen;
  const records: Array<{ tag: string; offset: number; length: number; checksum: number }> = [];
  const parts: Uint8Array[] = [];

  for (const [tag, data] of tables) {
    const padded = new Uint8Array((data.length + 3) & ~3);
    padded.set(data);
    records.push({ tag, offset, length: data.length, checksum: tableChecksum(padded) });
    parts.push(padded);
    offset += padded.length;
  }

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, numTables, false);
  view.setUint16(6, searchRange, false);
  view.setUint16(8, entrySelector, false);
  view.setUint16(10, rangeShift, false);

  records.forEach((rec, i) => {
    const o = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[o + j] = rec.tag.charCodeAt(j);
    view.setUint32(o + 4, rec.checksum, false);
    view.setUint32(o + 8, rec.offset, false);
    view.setUint32(o + 12, rec.length, false);
  });

  let p = headerLen;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }

  // checkSumAdjustment: 0xB1B0AFBA - checksum of entire font (with the field zeroed)
  const headRec = records.find((r) => r.tag === 'head')!;
  const adjField = headRec.offset + 8;
  view.setUint32(adjField, 0, false);
  const total = tableChecksum(out);
  view.setUint32(adjField, (0xb1b0afba - total) >>> 0, false);

  return out;
}

function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v =
      ((data[i]! << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return sum >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

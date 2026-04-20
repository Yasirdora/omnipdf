/**
 * DEFLATE decompressor (RFC 1951): stored, fixed-Huffman, and dynamic-Huffman
 * blocks. Written to complete our own codec pair (deflate.ts compresses) so
 * round-trip restore needs no dependency and works outside Node.
 *
 * Validated against zlib both directions in tests.
 */

class BitReader {
  private bit = 0;
  constructor(private readonly bytes: Uint8Array) {}
  /** Read n bits (LSB-first per DEFLATE). */
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.bit >> 3];
      if (byte === undefined) throw new Error('inflate: unexpected end of input');
      v |= ((byte >> (this.bit & 7)) & 1) << i;
      this.bit++;
    }
    return v;
  }
  alignToByte(): void {
    this.bit = (this.bit + 7) & ~7;
  }
  /** Absolute byte seek (used after stored-block headers). */
  seekByte(off: number): void {
    this.bit = off * 8;
  }
  get byteOffset(): number {
    return (this.bit + 7) >> 3;
  }
}

interface Huffman {
  /** counts[len] = number of codes with that length */
  counts: Uint16Array;
  /** symbols sorted by (length, symbol order) */
  symbols: Uint16Array;
}

function buildHuffman(lengths: Uint8Array): Huffman {
  const counts = new Uint16Array(16);
  for (const len of lengths) counts[len]!++;
  counts[0] = 0; // length 0 = unused, not a code
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1]! + counts[i - 1]!;
  const symbols = new Uint16Array(lengths.filter((l) => l > 0).length);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym]!;
    if (len > 0) symbols[offsets[len]!++] = sym;
  }
  return { counts, symbols };
}

function decodeSymbol(r: BitReader, h: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len < 16; len++) {
    code |= r.read(1);
    const count = h.counts[len]!;
    if (code - first < count) return h.symbols[index + (code - first)]!;
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error('inflate: invalid Huffman code');
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function fixedHuffman(): { litlen: Huffman; dist: Huffman } {
  const litLengths = new Uint8Array(288);
  for (let i = 0; i < 144; i++) litLengths[i] = 8;
  for (let i = 144; i < 256; i++) litLengths[i] = 9;
  for (let i = 256; i < 280; i++) litLengths[i] = 7;
  for (let i = 280; i < 288; i++) litLengths[i] = 8;
  const distLengths = new Uint8Array(30).fill(5);
  return { litlen: buildHuffman(litLengths), dist: buildHuffman(distLengths) };
}

const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Adler-32 checksum (RFC 1950). */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Inflate a zlib-format stream (RFC 1950: 2-byte header + raw DEFLATE +
 * adler32 trailer) — the format PDF FlateDecode actually uses, and the
 * format our deflate() emits.
 */
export function inflateZlib(input: Uint8Array, expectedSize?: number): Uint8Array {
  if (input.length < 6) throw new Error('inflateZlib: input too short');
  const cmf = input[0]!;
  const flg = input[1]!;
  if ((cmf & 0x0f) !== 8) throw new Error('inflateZlib: unsupported compression method');
  if ((cmf * 256 + flg) % 31 !== 0) throw new Error('inflateZlib: header check failed');
  if (flg & 0x20) throw new Error('inflateZlib: preset dictionaries unsupported');
  const out = inflate(input.subarray(2, input.length - 4), expectedSize);
  const view = new DataView(input.buffer, input.byteOffset + input.length - 4, 4);
  if (view.getUint32(0, false) !== adler32(out)) throw new Error('inflateZlib: adler32 mismatch');
  return out;
}

/** Inflate raw DEFLATE data (no zlib/gzip wrapper). */
export function inflate(input: Uint8Array, expectedSize?: number): Uint8Array {
  const r = new BitReader(input);
  const out: number[] = [];
  let fixed: { litlen: Huffman; dist: Huffman } | null = null;

  for (;;) {
    const bfinal = r.read(1);
    const btype = r.read(2);
    if (btype === 0) {
      // stored block
      r.alignToByte();
      const off = r.byteOffset;
      const len = input[off]! | (input[off + 1]! << 8);
      const nlen = input[off + 2]! | (input[off + 3]! << 8);
      if ((len ^ nlen) !== 0xffff) throw new Error('inflate: stored block NLEN mismatch');
      for (let i = 0; i < len; i++) out.push(input[off + 4 + i]!);
      r.seekByte(off + 4 + len);
    } else {
      let litlen: Huffman;
      let dist: Huffman;
      if (btype === 1) {
        fixed ??= fixedHuffman();
        litlen = fixed.litlen;
        dist = fixed.dist;
      } else if (btype === 2) {
        const hlit = r.read(5) + 257;
        const hdist = r.read(5) + 1;
        const hclen = r.read(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[CODE_LENGTH_ORDER[i]!] = r.read(3);
        const clHuffman = buildHuffman(clLengths);
        const lengths = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < hlit + hdist) {
          const sym = decodeSymbol(r, clHuffman);
          if (sym < 16) {
            lengths[i++] = sym;
          } else if (sym === 16) {
            const prev = lengths[i - 1];
            if (prev === undefined) throw new Error('inflate: repeat with no previous length');
            const repeat = 3 + r.read(2);
            for (let k = 0; k < repeat; k++) lengths[i++] = prev;
          } else if (sym === 17) {
            const repeat = 3 + r.read(3);
            i += repeat;
          } else {
            const repeat = 11 + r.read(7);
            i += repeat;
          }
        }
        if (i > hlit + hdist) throw new Error('inflate: too many code lengths');
        litlen = buildHuffman(lengths.subarray(0, hlit));
        dist = buildHuffman(lengths.subarray(hlit));
      } else {
        throw new Error('inflate: reserved block type 3');
      }

      for (;;) {
        const sym = decodeSymbol(r, litlen);
        if (sym === 256) break; // end of block
        if (sym < 256) {
          out.push(sym);
          continue;
        }
        const li = sym - 257;
        if (li > 28) throw new Error('inflate: invalid length symbol');
        const length = LENGTH_BASE[li]! + r.read(LENGTH_EXTRA[li]!);
        const dsym = decodeSymbol(r, dist);
        if (dsym > 29) throw new Error('inflate: invalid distance symbol');
        const distance = DIST_BASE[dsym]! + r.read(DIST_EXTRA[dsym]!);
        if (distance > out.length) throw new Error('inflate: distance too far back');
        for (let k = 0; k < length; k++) out.push(out[out.length - distance]!);
      }
    }
    if (bfinal) break;
  }

  if (expectedSize !== undefined && out.length !== expectedSize) {
    throw new Error(`inflate: size mismatch (got ${out.length}, expected ${expectedSize})`);
  }
  return new Uint8Array(out);
}

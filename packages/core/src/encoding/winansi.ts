/**
 * WinAnsiEncoding (CP1252-compatible) text encoding for base-14 Latin fonts.
 *
 * Base-14 PDF fonts with /WinAnsiEncoding accept single bytes 0x20–0xFF.
 * Bytes 0x80–0x9F carry the "special" characters (€, smart quotes, dashes…).
 * Characters outside this repertoire throw a descriptive error — embedded
 * TTF fonts (Phase 1) are the answer for full Unicode, not silent tofu.
 */

/** Unicode code point -> WinAnsi byte, for the 0x80–0x9F special range. */
const SPECIALS: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // € Euro
  [0x201a, 0x82], // ‚ single low-9 quote
  [0x0192, 0x83], // ƒ florin
  [0x201e, 0x84], // „ double low-9 quote
  [0x2026, 0x85], // … ellipsis
  [0x2020, 0x86], // † dagger
  [0x2021, 0x87], // ‡ double dagger
  [0x02c6, 0x88], // ˆ circumflex
  [0x2030, 0x89], // ‰ per mille
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹ single guillemet
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ' left single quote
  [0x2019, 0x92], // ' right single quote
  [0x201c, 0x93], // " left double quote
  [0x201d, 0x94], // " right double quote
  [0x2022, 0x95], // • bullet
  [0x2013, 0x96], // – en dash
  [0x2014, 0x97], // — em dash
  [0x02dc, 0x98], // ˜ small tilde
  [0x2122, 0x99], // ™ trademark
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // › right guillemet
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
  // Friendly aliases that typesetters expect to "just work":
  [0x2212, 0x2d], // − minus sign -> hyphen-minus
  [0x00ad, 0x2d], // soft hyphen -> hyphen-minus
]);

export class UnsupportedCharacterError extends Error {
  readonly char: string;
  readonly codePoint: number;
  constructor(char: string, codePoint: number) {
    super(
      `Character ${JSON.stringify(char)} (U+${codePoint
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}) is not representable in WinAnsiEncoding. ` +
        `Use an embedded TTF font for full Unicode support.`,
    );
    this.name = 'UnsupportedCharacterError';
    this.char = char;
    this.codePoint = codePoint;
  }
}

/** Map a single Unicode code point to its WinAnsi byte, or throw. */
export function codePointToWinAnsi(cp: number): number {
  if (cp >= 0x20 && cp <= 0x7e) return cp; // printable ASCII
  if (cp >= 0xa0 && cp <= 0xff) return cp; // Latin-1 supplement direct range
  const special = SPECIALS.get(cp);
  if (special !== undefined) return special;
  throw new UnsupportedCharacterError(String.fromCodePoint(cp), cp);
}

/** Encode a JS string as raw WinAnsi bytes (no PDF string escaping). */
export function encodeWinAnsi(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  let i = 0;
  for (const ch of str) {
    out[i++] = codePointToWinAnsi(ch.codePointAt(0)!);
  }
  return out.subarray(0, i);
}

/** Encode a JS string as a PDF literal string body: (escaped). */
export function encodePdfString(str: string): string {
  let out = '';
  for (const ch of str) {
    const b = codePointToWinAnsi(ch.codePointAt(0)!);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else out += String.fromCharCode(b);
  }
  return `(${out})`;
}

/** Encode a JS string as a PDF hex string: <FEFF…> UTF-16BE (for metadata that may exceed WinAnsi). */
export function encodePdfStringUtf16(str: string): string {
  let hex = 'feff';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return `<${hex}>`;
}

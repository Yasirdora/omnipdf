/**
 * Base-14 standard font metrics, backed by Adobe's AFM data
 * (generated into afm-data.json by scripts/build-afm-data.mjs).
 *
 * Widths are in 1/1000 em. Kerning pairs come from the same AFM files.
 * Symbol and ZapfDingbats use their own built-in encodings (byte-indexed);
 * the twelve Latin fonts use WinAnsiEncoding.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import afmData from './afm-data.json';

export const STANDARD_FONTS = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Symbol', 'ZapfDingbats',
] as const;

export type StandardFontName = (typeof STANDARD_FONTS)[number];

export const LATIN_FONTS: ReadonlySet<string> = new Set(STANDARD_FONTS.slice(0, 12));

/** WinAnsiEncoding byte -> Adobe glyph name (index 0x00–0xFF; '' = undefined). */
// prettier-ignore
const WINANSI_GLYPHS: readonly string[] = [
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // 0x00-0x0F
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', // 0x10-0x1F
  'space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quotesingle',
  'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
  'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'grave',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
  'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  'braceleft', 'bar', 'braceright', 'asciitilde', '', // 0x7F undefined
  'Euro', '', 'quotesinglbase', 'florin', 'quotedblbase', 'ellipsis', 'dagger', 'daggerdbl',
  'circumflex', 'perthousand', 'Scaron', 'guilsinglleft', 'OE', '', 'Zcaron', '',
  '', 'quoteleft', 'quoteright', 'quotedblleft', 'quotedblright', 'bullet', 'endash', 'emdash',
  'tilde', 'trademark', 'scaron', 'guilsinglright', 'oe', '', 'zcaron', 'Ydieresis',
  'nbspace', 'exclamdown', 'cent', 'sterling', 'currency', 'yen', 'brokenbar', 'section',
  'dieresis', 'copyright', 'ordfeminine', 'guillemotleft', 'logicalnot', 'hyphen', 'registered', 'macron',
  'degree', 'plusminus', 'twosuperior', 'threesuperior', 'acute', 'mu', 'paragraph', 'periodcentered',
  'cedilla', 'onesuperior', 'ordmasculine', 'guillemotright', 'onequarter', 'onehalf', 'threequarters', 'questiondown',
  'Agrave', 'Aacute', 'Acircumflex', 'Atilde', 'Adieresis', 'Aring', 'AE', 'Ccedilla',
  'Egrave', 'Eacute', 'Ecircumflex', 'Edieresis', 'Igrave', 'Iacute', 'Icircumflex', 'Idieresis',
  'Eth', 'Ntilde', 'Ograve', 'Oacute', 'Ocircumflex', 'Otilde', 'Odieresis', 'multiply', 'Oslash',
  'Ugrave', 'Uacute', 'Ucircumflex', 'Udieresis', 'Yacute', 'Thorn', 'germandbls',
  'agrave', 'aacute', 'acircumflex', 'atilde', 'adieresis', 'aring', 'ae', 'ccedilla',
  'egrave', 'eacute', 'ecircumflex', 'edieresis', 'igrave', 'iacute', 'icircumflex', 'idieresis',
  'eth', 'ntilde', 'ograve', 'oacute', 'ocircumflex', 'otilde', 'odieresis', 'divide', 'oslash',
  'ugrave', 'uacute', 'ucircumflex', 'udieresis', 'yacute', 'thorn', 'ydieresis',
];

interface AfmFont {
  glyphWidths: Record<string, number>;
  codeWidths: Record<string, number>;
  kernPairs: Record<string, number>;
  capheight?: number;
  xheight?: number;
  ascender?: number;
  descender?: number;
  italicangle?: number;
  underlineposition?: number;
  underlinethickness?: number;
}

const FONTS = (afmData as { fonts: Record<string, AfmFont> }).fonts;

export interface FontMetrics {
  readonly name: StandardFontName;
  readonly isLatin: boolean;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly ascender: number;
  readonly descender: number;
  readonly italicAngle: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  /** Width of one WinAnsi/native byte in 1/1000 em. */
  widthOfByte(byte: number): number;
  /** Width of a string at 1pt size, in 1/1000 em, optionally with kerning. */
  widthOf(text: string, kern?: boolean): number;
  /** Width of a string at `size` pt, in points. */
  widthAt(text: string, size: number, opts?: { kern?: boolean; charSpacing?: number }): number;
}

const metricsCache = new Map<string, FontMetrics>();

export function getFontMetrics(name: StandardFontName): FontMetrics {
  const cached = metricsCache.get(name);
  if (cached) return cached;

  const raw = FONTS[name];
  if (!raw) throw new Error(`Unknown standard font: ${name}`);
  const isLatin = LATIN_FONTS.has(name);

  const widthOfByte = (byte: number): number => {
    if (isLatin) {
      const glyph = WINANSI_GLYPHS[byte];
      if (!glyph) return 0;
      const w = raw.glyphWidths[glyph];
      if (w !== undefined) return w;
      // nbspace and friends occasionally missing from AFM: fall back to space width
      return raw.glyphWidths['space'] ?? 0;
    }
    return raw.codeWidths[String(byte)] ?? 0;
  };

  const kernOf = (leftByte: number, rightByte: number): number => {
    if (!isLatin) return 0;
    const l = WINANSI_GLYPHS[leftByte];
    const r = WINANSI_GLYPHS[rightByte];
    if (!l || !r) return 0;
    return raw.kernPairs[`${l} ${r}`] ?? 0;
  };

  const widthOf = (text: string, kern = true): number => {
    let total = 0;
    let prev = -1;
    for (const ch of text) {
      const b = latinByteForChar(ch);
      total += widthOfByte(b);
      if (kern && prev >= 0) total += kernOf(prev, b);
      prev = b;
    }
    return total;
  };

  const metrics: FontMetrics = {
    name,
    isLatin,
    capHeight: raw.capheight ?? 0,
    xHeight: raw.xheight ?? 0,
    ascender: raw.ascender ?? 0,
    descender: raw.descender ?? 0,
    italicAngle: raw.italicangle ?? 0,
    underlinePosition: raw.underlineposition ?? -100,
    underlineThickness: raw.underlinethickness ?? 50,
    widthOfByte,
    widthOf,
    widthAt(text, size, opts) {
      const base = widthOf(text, opts?.kern ?? true) * (size / 1000);
      const cs = opts?.charSpacing ?? 0;
      return base + cs * text.length;
    },
  };

  metricsCache.set(name, metrics);
  return metrics;
}

/** Resolve a character to its WinAnsi byte for width lookup (mirrors winansi.ts mapping). */
function latinByteForChar(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x20 && cp <= 0x7e) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  // keep in sync with SPECIALS in encoding/winansi.ts
  switch (cp) {
    case 0x20ac: return 0x80; case 0x201a: return 0x82; case 0x0192: return 0x83;
    case 0x201e: return 0x84; case 0x2026: return 0x85; case 0x2020: return 0x86;
    case 0x2021: return 0x87; case 0x02c6: return 0x88; case 0x2030: return 0x89;
    case 0x0160: return 0x8a; case 0x2039: return 0x8b; case 0x0152: return 0x8c;
    case 0x017d: return 0x8e; case 0x2018: return 0x91; case 0x2019: return 0x92;
    case 0x201c: return 0x93; case 0x201d: return 0x94; case 0x2022: return 0x95;
    case 0x2013: return 0x96; case 0x2014: return 0x97; case 0x02dc: return 0x98;
    case 0x2122: return 0x99; case 0x0161: return 0x9a; case 0x203a: return 0x9b;
    case 0x0153: return 0x9c; case 0x017e: return 0x9e; case 0x0178: return 0x9f;
    case 0x2212: return 0x2d; case 0x00ad: return 0x2d;
    default: return 0x20; // unknown glyphs measure as space; encoding throws separately
  }
}

/**
 * @omnipdf/core — zero-dependency, deterministic PDF writer.
 *
 * Public API surface. Everything here runs identically in Node, browsers,
 * Deno, and Web Workers: no DOM, no platform APIs, just Uint8Array.
 */
export { Document, Page, hexToRgb, pdfColor, parseJpegSize } from './document.js';
export type {
  DocumentMetadata,
  DocumentOptions,
  TextOptions,
  OutlineItem,
} from './document.js';
export { PdfWriter, ascii, concatBytes, fx } from './writer.js';
export { deflate } from './deflate.js';
export {
  encodeWinAnsi,
  encodePdfString,
  encodePdfStringUtf16,
  UnsupportedCharacterError,
} from './encoding/winansi.js';
export {
  getFontMetrics,
  STANDARD_FONTS,
  LATIN_FONTS,
} from './fonts/standard.js';
export type { StandardFontName, FontMetrics } from './fonts/standard.js';

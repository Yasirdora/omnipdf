import { describe, it, expect } from 'vitest';
import {
  encodeWinAnsi,
  encodePdfString,
  encodePdfStringUtf16,
  UnsupportedCharacterError,
} from '../src/encoding/winansi.js';

describe('winansi encoding', () => {
  it('encodes printable ASCII directly', () => {
    expect([...encodeWinAnsi('Hello, World!')]).toEqual([...'Hello, World!'].map((c) => c.charCodeAt(0)));
  });

  it('encodes Latin-1 supplement directly', () => {
    expect([...encodeWinAnsi('café €uro')]).toContain(0xe9); // é
    expect([...encodeWinAnsi('€')]).toEqual([0x80]);
  });

  it('maps typographic characters into the special range', () => {
    expect([...encodeWinAnsi('\u201Cquote\u201D \u2014 \u2026')]).toEqual([0x93, ...[...'quote'].map((c) => c.charCodeAt(0)), 0x94, 0x20, 0x97, 0x20, 0x85]);
  });

  it('aliases Unicode minus to hyphen', () => {
    expect([...encodeWinAnsi('\u2212')]).toEqual([0x2d]);
  });

  it('throws a descriptive error for unsupported characters', () => {
    expect(() => encodeWinAnsi('你好')).toThrow(UnsupportedCharacterError);
    try {
      encodeWinAnsi('你');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedCharacterError);
      expect((e as UnsupportedCharacterError).codePoint).toBe(0x4f60);
      expect((e as Error).message).toContain('U+4F60');
    }
  });

  it('escapes PDF literal string delimiters', () => {
    expect(encodePdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
  });

  it('encodes UTF-16 hex strings with BOM', () => {
    expect(encodePdfStringUtf16('AB')).toBe('<feff00410042>');
  });
});

import { describe, it, expect } from 'vitest';
import { getFontMetrics } from '../src/fonts/standard.js';

describe('base-14 font metrics (Adobe AFM)', () => {
  it('reports correct Helvetica glyph widths', () => {
    const h = getFontMetrics('Helvetica');
    expect(h.widthAt('W', 1000)).toBe(944); // Helvetica W = 944/1000 em
    expect(h.widthAt('i', 1000)).toBe(222);
    expect(h.widthAt(' ', 1000)).toBe(278); // space
    expect(h.widthAt('s', 1000)).toBe(500);
  });

  it('reports identical widths for all Courier glyphs', () => {
    const c = getFontMetrics('Courier');
    expect(c.widthAt('i', 1000)).toBe(600);
    expect(c.widthAt('W', 1000)).toBe(600);
  });

  it('applies AFM kerning between glyph pairs', () => {
    const h = getFontMetrics('Helvetica');
    const unkerned = h.widthOf('AV', false);
    const kerned = h.widthOf('AV', true);
    expect(kerned).toBeLessThan(unkerned);
  });

  it('measures strings at point sizes', () => {
    const h = getFontMetrics('Helvetica');
    expect(h.widthAt('WW', 10)).toBeCloseTo(2 * 944 * 0.01, 5);
  });

  it('exposes font-level metrics', () => {
    const t = getFontMetrics('Times-Roman');
    expect(t.capHeight).toBe(662);
    expect(t.italicAngle).toBe(0);
    expect(getFontMetrics('Helvetica-Oblique').italicAngle).toBe(-12);
  });

  it('treats Symbol as a non-Latin (native-encoded) font', () => {
    const s = getFontMetrics('Symbol');
    expect(s.isLatin).toBe(false);
    expect(s.widthOfByte(0x61)).toBeGreaterThan(0); // 'alpha' slot
  });
});

import { describe, it, expect } from 'vitest';
import { FontRegistry, Measurer } from '../src/measurer.js';
import { TableBlock, resolveColumns, type ResolvedTableStyle } from '../src/table.js';
import type { StyledRun } from '../src/line-break.js';
import type { LayoutContext } from '../src/blocks.js';
import type { ResolvedParagraphStyle } from '../src/types.js';

const registry = new FontRegistry();
const measurer = new Measurer(registry);

const style: ResolvedTableStyle = {
  font: 'Helvetica',
  size: 10,
  lineHeight: 1.25,
  color: '#000',
  padding: 4,
  borders: 'horizontal',
  borderColor: '#ccc',
  headerFont: 'Helvetica-Bold',
  headerColor: '#000',
  headerFill: '#eee',
};

const cell = (text: string): StyledRun[] => [{ text, font: 'Helvetica', size: 10, color: '#000' }];

const defaultStyle: ResolvedParagraphStyle = {
  font: 'Helvetica', size: 10, lineHeight: 1.25, color: '#000', align: 'left',
  spaceBefore: 0, spaceAfter: 0, indent: 0, firstLineIndent: 0,
};

const ctx = (contentHeight = 700): LayoutContext => ({ measurer, contentHeight, defaultStyle });

describe('resolveColumns', () => {
  const rows = [[cell('Item'), cell('Description of item'), cell('9.99')]];

  it('honors fixed widths and fills stars with the remainder', () => {
    const w = resolveColumns([100, '*', 80], 400, rows, measurer, 4);
    expect(w[0]).toBe(100);
    expect(w[2]).toBe(80);
    expect(w[1]).toBeCloseTo(220, 0);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 0);
  });

  it('weights star columns', () => {
    const w = resolveColumns(['2*', '*'], 300, rows, measurer, 4);
    expect(w[0]).toBeCloseTo(200, 0);
    expect(w[1]).toBeCloseTo(100, 0);
  });

  it('resolves percentages against the table width', () => {
    const w = resolveColumns(['50%', '25%', '25%'], 400, rows, measurer, 4);
    expect(w).toEqual([200, 100, 100]);
  });

  it('auto columns size to content and absorb leftover when no stars', () => {
    const w = resolveColumns(['auto', 'auto'], 400, rows, measurer, 4);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 0);
    // wider content gets wider column
    expect(w[1]!).toBeGreaterThan(w[0]!);
  });

  it('never overflows the container, even with greedy fixed widths', () => {
    const w = resolveColumns([300, 300, 300], 400, rows, measurer, 4);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 0);
  });

  it('auto columns shrink toward their longest word under pressure', () => {
    const narrow = [[cell('a'), cell('supercalifragilistic'), cell('x')]];
    const w = resolveColumns(['auto', 'auto', '*'], 200, narrow, measurer, 4);
    const total = w.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(200 + 1e-6);
    // star floored at its min content width
    expect(w[2]!).toBeGreaterThan(0);
  });
});

describe('TableBlock', () => {
  it('produces one slice per row with resolved column widths', () => {
    const table = new TableBlock({
      columns: [80, '*', 60],
      rows: [ [cell('A'), cell('B'), cell('C')], [cell('1'), cell('2'), cell('3')] ],
      style,
    });
    const slices = table.layout(400, ctx());
    expect(slices.length).toBe(2);
    const s0 = slices[0]!;
    if (s0.kind !== 'table-row') throw new Error('expected table-row');
    expect(s0.colWidths.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 0);
    expect(s0.height).toBeCloseTo(10 * 1.25 + 8); // one line + padding
  });

  it('flags header rows and attaches the fill', () => {
    const table = new TableBlock({
      columns: ['*', '*'],
      header: 1,
      rows: [ [cell('H1'), cell('H2')], [cell('a'), cell('b')] ],
      style,
    });
    const slices = table.layout(400, ctx());
    const [h, body] = slices;
    if (h!.kind !== 'table-row' || body!.kind !== 'table-row') throw new Error('rows');
    expect(h!.header).toBe(true);
    expect(h!.fill).toBe('#eee');
    expect(body!.header).toBe(false);
    expect(body!.fill).toBeUndefined();
  });

  it('wraps cell text to the resolved column width', () => {
    const long = 'word '.repeat(50).trim();
    const table = new TableBlock({
      columns: [100, 100],
      rows: [[cell(long), cell('short')]],
      style,
    });
    const slices = table.layout(200, ctx());
    const row = slices[0]!;
    if (row.kind !== 'table-row') throw new Error('row');
    expect(row.cells[0]!.lines.length).toBeGreaterThan(3);
    for (const line of row.cells[0]!.lines) {
      expect(line.width).toBeLessThanOrEqual(100 - 8 + 1e-6);
    }
    // row height follows the taller cell
    expect(row.height).toBe(row.cells[0]!.height);
  });

  it('chunks pathologically tall rows at page-sized boundaries', () => {
    const huge = 'word '.repeat(2000).trim();
    const table = new TableBlock({
      columns: [100],
      rows: [[cell(huge)]],
      style,
    });
    const slices = table.layout(100, ctx(300));
    expect(slices.length).toBeGreaterThan(1);
    for (const s of slices) {
      expect(s.height).toBeLessThanOrEqual(300 + 1e-6);
    }
    // no text lost across chunks
    const text = slices
      .flatMap((s) => (s.kind === 'table-row' ? s.cells[0]!.lines : []))
      .flatMap((l) => l.runs.map((r) => r.text))
      .join(' ');
    expect(text.replace(/\s+/g, ' ').trim()).toBe(huge);
  });
});

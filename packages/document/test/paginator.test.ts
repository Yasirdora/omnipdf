import { describe, it, expect } from 'vitest';
import { FontRegistry, Measurer } from '../src/measurer.js';
import { ParagraphBlock } from '../src/blocks.js';
import { TableBlock, type ResolvedTableStyle } from '../src/table.js';
import { paginate, type PageGeometry, type PaginationContext } from '../src/paginator.js';
import type { StyledRun } from '../src/line-break.js';
import type { ResolvedParagraphStyle } from '../src/types.js';

// Deterministic geometry: 12 lines of 15pt per page (contentH = 180).
const geom: PageGeometry = {
  pageWidth: 200,
  pageHeight: 200,
  marginTop: 10,
  marginRight: 10,
  marginBottom: 10,
  marginLeft: 10,
};

const style: ResolvedParagraphStyle = {
  font: 'Helvetica', size: 12, lineHeight: 1.25, color: '#000', align: 'left',
  spaceBefore: 0, spaceAfter: 0, indent: 0, firstLineIndent: 0,
};

const tableStyle: ResolvedTableStyle = {
  font: 'Helvetica', size: 10, lineHeight: 1.25, color: '#000', padding: 4,
  borders: 'horizontal', borderColor: '#ccc', headerFont: 'Helvetica-Bold',
  headerColor: '#000', headerFill: '#eee',
};

const registry = new FontRegistry();
const measurer = new Measurer(registry);

/** Paragraph with exactly `n` lines via forced breaks. */
function para(n: number, over: Partial<StyledRun> = {}, props = {}): ParagraphBlock {
  const runs: StyledRun[] = Array.from({ length: n }, (_, i) => ({
    text: i < n - 1 ? `line${i}\n` : `line${n - 1}`,
    font: 'Helvetica', size: 12, color: '#000', ...over,
  }));
  return new ParagraphBlock(runs, style, props, 'P');
}

function ctxWith(notes: ReadonlyMap<number, string>): PaginationContext {
  return {
    measurer,
    contentHeight: geom.pageHeight - geom.marginTop - geom.marginBottom,
    defaultStyle: style,
    notes,
    noteStyle: { font: 'Helvetica', size: 8.5, lineHeight: 1.25, color: '#000' },
  };
}

const noNotes = new Map<number, string>();

describe('paginator: basic flow', () => {
  it('packs a short document onto one page', () => {
    const pages = paginate([para(5)], ctxWith(noNotes), geom);
    expect(pages.length).toBe(1);
    expect(pages[0]!.placements.length).toBe(5);
  });

  it('flows long content across pages without losing lines', () => {
    const pages = paginate([para(30)], ctxWith(noNotes), geom);
    expect(pages.length).toBe(3); // 12 + 12 + 6
    const total = pages.reduce((a, p) => a + p.placements.length, 0);
    expect(total).toBe(30);
  });

  it('drops leading space at page tops and collapses adjacent spaces', () => {
    const big = new ParagraphBlock(
      [{ text: 'x', font: 'Helvetica', size: 12, color: '#000' }],
      { ...style, spaceAfter: 40 },
      {},
      'P',
    );
    const pages = paginate([para(12), big, para(3)], ctxWith(noNotes), geom);
    expect(pages.length).toBe(2);
    // page 2 starts with text, not the 40pt space
    expect(pages[1]!.placements[0]!.slice.kind).toBe('text');
  });
});

describe('paginator: keep rules', () => {
  it('keepTogether pushes a block whole to the next page', () => {
    const keep = para(5, {}, { keepTogether: true });
    const pages = paginate([para(10), keep], ctxWith(noNotes), geom);
    expect(pages.length).toBe(2);
    expect(pages[0]!.placements.length).toBe(10);
    expect(pages[1]!.placements.length).toBe(5);
  });

  it('keepWithNext rewinds a heading stranded at the page bottom', () => {
    const heading = para(1, {}, { keepWithNext: true });
    const pages = paginate([para(11), heading, para(5)], ctxWith(noNotes), geom);
    expect(pages.length).toBe(2);
    // page 1: 11 lines only — heading moved to page 2 with its paragraph
    expect(pages[0]!.placements.length).toBe(11);
    expect(pages[1]!.placements.length).toBe(6);
  });

  it('orphans: never leaves a single line at the page bottom', () => {
    const pages = paginate([para(11), para(3)], ctxWith(noNotes), geom);
    // naive split would be 12 / 2; orphans=2 forces 11 / 3
    expect(pages[0]!.placements.length).toBe(11);
    expect(pages[1]!.placements.length).toBe(3);
  });

  it('widows: pulls a line back so the next page has at least two', () => {
    // 11 + 13 lines: page2 of para B would get 1 widow line without the rule
    const pages = paginate([para(11), para(14)], ctxWith(noNotes), geom);
    // para A=11 on p1; B: p2 gets 11 lines, p3 gets 2 (widow fix) — or similar valid split
    const last = pages[pages.length - 1]!;
    const lastCount = last.placements.filter((p) => p.slice.kind === 'text').length;
    expect(lastCount).toBeGreaterThanOrEqual(2);
  });
});

describe('paginator: footnotes', () => {
  it('sets the note on the same page as its reference when room allows', () => {
    const notes = new Map([[1, 'A short note.']]);
    const p = para(5, { noteId: 1 });
    const pages = paginate([p], ctxWith(notes), geom);
    expect(pages.length).toBe(1);
    const noteKinds = pages[0]!.notes.map((n) => n.slice.kind);
    expect(noteKinds).toEqual(['rule', 'text']);
    // notes anchored at the bottom of the content box
    const lastNote = pages[0]!.notes[pages[0]!.notes.length - 1]!;
    expect(lastNote.y + lastNote.slice.height).toBeCloseTo(180, 0);
  });

  it('THE fixpoint: a note pushes its own reference line to the next page', () => {
    // 11 lines fill 165pt; the note area (~27pt) leaves only ~153pt,
    // so line 11 — which carries the reference — must move, with its note.
    const notes = new Map([[1, 'Note on the last line.']]);
    const runs: StyledRun[] = Array.from({ length: 11 }, (_, i) => ({
      text: i < 10 ? `line${i}\n` : `line10`,
      font: 'Helvetica', size: 12, color: '#000',
      ...(i === 10 ? { noteId: 1 } : {}),
    }));
    const p = new ParagraphBlock(runs, style, {}, 'P');
    const pages = paginate([p], ctxWith(notes), geom);
    expect(pages.length).toBe(2);
    // 11th line is pushed by the note area; the widow rule pulls line 10
    // down with it (no single line stranded on page 2)
    expect(pages[0]!.placements.length).toBe(9);
    expect(pages[0]!.notes.length).toBe(0); // note left with its reference
    expect(pages[1]!.placements.length).toBe(2);
    expect(pages[1]!.notes.map((n) => n.slice.kind)).toEqual(['rule', 'text']);
  });

  it('rejects a footnote taller than 80% of a page with a clear error', () => {
    const notes = new Map([[1, 'word '.repeat(500)]]);
    const p = para(2, { noteId: 1 });
    expect(() => paginate([p], ctxWith(notes), geom)).toThrow(/Footnote #1/);
  });
});

describe('paginator: tables', () => {
  const cell = (t: string): StyledRun[] => [{ text: t, font: 'Helvetica', size: 10, color: '#000' }];

  it('repeats header rows on continuation pages', () => {
    // row height = 10*1.25 + 8 = 20.5 → 8 rows per 180pt page
    const rows = [
      [cell('H1'), cell('H2')],
      ...Array.from({ length: 20 }, (_, i) => [cell(`r${i}a`), cell(`r${i}b`)]),
    ];
    const table = new TableBlock({ columns: ['*', '*'], header: 1, rows, style: tableStyle });
    const pages = paginate([table], ctxWith(noNotes), geom);
    expect(pages.length).toBe(3); // (1+7) + (1+7) + (1+6) — header repeats everywhere
    for (const [i, expected] of [8, 8, 7].entries()) {
      expect(pages[i]!.placements.length).toBe(expected);
    }
    for (const page of pages.slice(1)) {
      const first = page.placements[0]!.slice;
      if (first.kind !== 'table-row') throw new Error('expected table-row');
      expect(first.header).toBe(true);
    }
  });
});

describe('paginator: determinism', () => {
  it('produces identical layouts for identical input', () => {
    const notes = new Map([[1, 'deterministic note']]);
    const blocks = () => [para(11), para(6, { noteId: 1 }), para(20)];
    const a = paginate(blocks(), ctxWith(notes), geom);
    const b = paginate(blocks(), ctxWith(notes), geom);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

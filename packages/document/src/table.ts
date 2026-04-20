/**
 * Table block: column-width resolution → row measurement → row slices.
 *
 * Column spec: fixed pt, '50%', 'auto' (content width, floored at the
 * longest word), '*', '2*' (weighted share of what remains). Resolution
 * always terminates with Σcols ≤ table width (proportional safety scale) —
 * a table can never overflow its container, no matter the input.
 *
 * Rows are atomic slices. A single row taller than one full page is chunked
 * at cell-line boundaries (documented fallback; such rows can't be atomic
 * by definition). Header rows are flagged so the paginator can repeat them
 * on every continuation page.
 */
import { breakLines, tokenize, type StyledRun } from './line-break.js';
import type { Measurer } from './measurer.js';
import type { Block, LayoutContext } from './blocks.js';
import type { BlockProps, CellLayout, LayoutLine, Slice } from './types.js';

export type ColumnSpec = number | 'auto' | '*' | `${number}*` | `${number}%`;

export interface ResolvedTableStyle {
  font: string;
  size: number;
  lineHeight: number;
  color: string;
  padding: number;
  borders: 'all' | 'horizontal' | 'none';
  borderColor: string;
  headerFont: string;
  headerColor: string;
  headerFill: string | null;
}

interface Cell {
  runs: StyledRun[];
  header: boolean;
}

/** Measure a cell's single-line (natural) and longest-word (minimum) widths. */
function cellWidthBounds(runs: StyledRun[], measurer: Measurer): { natural: number; min: number } {
  const tokens = tokenize(runs, measurer).filter((t) => !t.forcedBreak);
  let natural = 0;
  let min = 0;
  for (const t of tokens) {
    natural += t.width;
    if (!t.glue) min = Math.max(min, t.width);
  }
  return { natural, min };
}

export function resolveColumns(
  specs: ColumnSpec[],
  tableWidth: number,
  rows: StyledRun[][][],
  measurer: Measurer,
  padding: number,
): number[] {
  const n = specs.length;
  const widths = new Array<number>(n).fill(0);
  const bounds = Array.from({ length: n }, (_, c) => {
    let natural = 0;
    let min = 0;
    for (const row of rows) {
      const runs = row[c];
      if (!runs) continue;
      const b = cellWidthBounds(runs, measurer);
      natural = Math.max(natural, b.natural);
      min = Math.max(min, b.min);
    }
    return { natural: natural + 2 * padding, min: min + 2 * padding };
  });

  const stars: Array<{ i: number; weight: number }> = [];
  const autos: number[] = [];
  let fixedSum = 0;
  for (let i = 0; i < n; i++) {
    const spec = specs[i]!;
    if (typeof spec === 'number') {
      widths[i] = spec;
      fixedSum += spec;
    } else if (spec === 'auto') {
      widths[i] = bounds[i]!.natural;
      fixedSum += widths[i]!;
      autos.push(i);
    } else if (spec.endsWith('%')) {
      widths[i] = (parseFloat(spec) / 100) * tableWidth;
      fixedSum += widths[i]!;
    } else {
      const w = spec === '*' ? 1 : parseFloat(spec);
      stars.push({ i, weight: w });
    }
  }

  let remaining = tableWidth - fixedSum;

  if (stars.length) {
    // stars share what's left, floored at min-content; deficit squeezes autos
    const totalWeight = stars.reduce((a, s) => a + s.weight, 0);
    let starFloor = 0;
    for (const s of stars) starFloor += bounds[s.i]!.min;
    const distributable = Math.max(remaining, starFloor);
    for (const s of stars) widths[s.i] = (s.weight / totalWeight) * distributable;
    remaining -= distributable;
    // squeeze autos toward their min if we overshot
    if (remaining < 0) shrinkAutos(widths, autos, bounds, remaining);
  } else if (autos.length) {
    // autos absorb leftover (positive or negative) proportionally
    shrinkAutos(widths, autos, bounds, remaining);
    remaining = 0;
  }

  // final safety: never exceed the container
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > tableWidth) {
    const scale = tableWidth / total;
    for (let i = 0; i < n; i++) widths[i] = widths[i]! * scale;
  }
  return widths.map((w) => Math.round(w * 1000) / 1000);
}

function shrinkAutos(
  widths: number[],
  autos: number[],
  bounds: Array<{ natural: number; min: number }>,
  delta: number,
): void {
  // delta > 0: grow proportionally to headroom; delta < 0: shrink toward min
  if (delta > 0) {
    const share = delta / autos.length;
    for (const i of autos) widths[i] = widths[i]! + share;
    return;
  }
  let deficit = -delta;
  // iterate: columns floored at min stop contributing to the deficit
  for (;;) {
    const flexible = autos.filter((i) => widths[i]! > bounds[i]!.min + 1e-6);
    if (!flexible.length || deficit <= 1e-6) break;
    const flexTotal = flexible.reduce((a, i) => a + (widths[i]! - bounds[i]!.min), 0);
    let consumed = 0;
    for (const i of flexible) {
      const take = Math.min(widths[i]! - bounds[i]!.min, deficit * ((widths[i]! - bounds[i]!.min) / flexTotal));
      widths[i] = widths[i]! - take;
      consumed += take;
    }
    deficit -= consumed;
    if (consumed <= 1e-6) break;
  }
}

export interface TableBlockOpts extends BlockProps {
  columns: ColumnSpec[];
  /** rows[r][c] = styled runs (pre-resolved by LayoutDocument). */
  rows: StyledRun[][][];
  /** Number of leading rows that are headers (repeated per page). */
  header?: number;
  /** Per-column horizontal alignment (default left). */
  columnAlign?: Array<'left' | 'right' | 'center'>;
  style: ResolvedTableStyle;
}

export class TableBlock implements Block {
  readonly role = 'Table' as const;
  readonly props: BlockProps;

  constructor(private readonly def: TableBlockOpts) {
    this.props = def;
  }

  layout(width: number, ctx: LayoutContext): Slice[] {
    const { style } = this.def;
    const headerCount = this.def.header ?? 0;
    const rows: Cell[][] = this.def.rows.map((row, r) =>
      row.map((runs) => ({ runs, header: r < headerCount })),
    );
    const colWidths = resolveColumns(this.def.columns, width, this.def.rows, ctx.measurer, style.padding);

    const slices: Slice[] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      const isHeader = r < headerCount;
      const cells: CellLayout[] = row.map((cell, c) => {
        const cellStyleRuns = cell.runs;
        const lines = breakLines(cellStyleRuns, ctx.measurer, {
          widthAt: () => Math.max(12, colWidths[c]! - 2 * style.padding),
          align: this.def.columnAlign?.[c] ?? 'left',
          lineHeight: style.lineHeight,
          fallback: { font: style.font, size: style.size },
        });
        const contentH = lines.reduce((a, l) => a + l.height, 0);
        return { lines, height: contentH + 2 * style.padding, header: isHeader };
      });
      const rowHeight = cells.reduce((a, c) => Math.max(a, c.height), 0);
      const maxRowH = ctx.contentHeight;
      if (rowHeight <= maxRowH) {
        slices.push(this.rowSlice(cells, colWidths, rowHeight, isHeader));
      } else {
        // pathological: a row taller than a page — chunk at line boundaries
        for (const chunk of chunkRow(cells, maxRowH, style.padding)) {
          slices.push(this.rowSlice(chunk.cells, colWidths, chunk.height, isHeader));
        }
      }
    }
    return slices;
  }

  private rowSlice(cells: CellLayout[], colWidths: number[], height: number, header: boolean): Slice {
    const s = this.def.style;
    return {
      kind: 'table-row',
      height,
      cells,
      colWidths,
      padding: s.padding,
      borders: s.borders,
      borderColor: s.borderColor,
      header,
      ...(header && s.headerFill ? { fill: s.headerFill } : {}),
      role: 'Table',
    };
  }
}

/** Split an over-tall row into page-sized chunks (cells chunk in lockstep). */
function chunkRow(
  cells: CellLayout[],
  maxHeight: number,
  padding: number,
): Array<{ cells: CellLayout[]; height: number }> {
  const budget = maxHeight - 2 * padding;
  const perCellChunks: LayoutLine[][][] = cells.map((cell) => {
    const chunks: LayoutLine[][] = [];
    let cur: LayoutLine[] = [];
    let h = 0;
    for (const line of cell.lines) {
      if (cur.length && h + line.height > budget) {
        chunks.push(cur);
        cur = [];
        h = 0;
      }
      cur.push(line);
      h += line.height;
    }
    if (cur.length) chunks.push(cur);
    return chunks.length ? chunks : [[]];
  });
  const chunkCount = Math.max(...perCellChunks.map((c) => c.length));
  const out: Array<{ cells: CellLayout[]; height: number }> = [];
  for (let k = 0; k < chunkCount; k++) {
    const chunkCells = cells.map((cell, i) => {
      const lines = perCellChunks[i]![k] ?? [];
      const h = lines.reduce((a, l) => a + l.height, 0) + 2 * padding;
      return { lines, height: h, header: cell.header };
    });
    out.push({ cells: chunkCells, height: chunkCells.reduce((a, c) => Math.max(a, c.height), 0) });
  }
  return out;
}

/**
 * Renderer: placements → @omnipdf/core drawing calls.
 *
 * Pure function of the paginator's output — the same PageLayout[] always
 * produces the same bytes (core build is deterministic: own deflate, no
 * timestamps, no random ids).
 */
import { Document as CoreDocument, Page as CorePage, EmbeddedFont, type DocumentOptions } from '@omnipdf/core';
import type { FontRegistry } from './measurer.js';
import type { PageGeometry } from './paginator.js';
import type { LayoutLine, PageLayout, Placement, Slice } from './types.js';

export interface FurnitureContext {
  /** 1-based page number. */
  page: number;
  /** Total page count (known at render time — furniture can't change layout). */
  pages: number;
}

export type FurnitureFn = (page: CorePage, ctx: FurnitureContext) => void;

export interface RenderOptions {
  metadata?: DocumentOptions;
  attachments?: Array<{
    name: string;
    data: Uint8Array;
    opts?: { mime?: string; description?: string; afRelationship?: 'Data' | 'Source' | 'Alternative' | 'Supplement' | 'Unspecified' };
  }>;
  header?: FurnitureFn;
  footer?: FurnitureFn;
}

export function renderPages(
  pages: PageLayout[],
  fonts: FontRegistry,
  geom: PageGeometry,
  opts: RenderOptions = {},
): Uint8Array {
  const doc = new CoreDocument(opts.metadata);

  // share the measurer's parsed EmbeddedFont instances with the core doc
  for (const [, f] of fonts.entries()) {
    if (f.embedded && f.ref instanceof EmbeddedFont) doc.embedFont(f.ref);
  }
  for (const a of opts.attachments ?? []) doc.attach(a.name, a.data, a.opts);

  const total = pages.length;
  for (const layout of pages) {
    const page = doc.addPage(geom.pageWidth, geom.pageHeight);
    const ctx: FurnitureContext = { page: layout.index, pages: total };
    opts.header?.(page, ctx);
    for (const p of layout.placements) drawPlacement(page, p, fonts, geom);
    for (const p of layout.notes) drawPlacement(page, p, fonts, geom);
    opts.footer?.(page, ctx);
  }
  return doc.build();
}

function drawPlacement(
  page: CorePage,
  p: Placement,
  fonts: FontRegistry,
  geom: PageGeometry,
): void {
  const x = geom.marginLeft + p.x;
  const y = geom.marginTop + p.y;
  drawSlice(page, p.slice, x, y, fonts, geom);
}

function drawSlice(
  page: CorePage,
  slice: Slice,
  x: number,
  y: number,
  fonts: FontRegistry,
  geom: PageGeometry,
): void {
  switch (slice.kind) {
    case 'space':
      return;
    case 'text': {
      let lineY = y;
      for (const line of slice.lines) {
        drawLine(page, line, x, lineY, fonts);
        lineY += line.height;
      }
      return;
    }
    case 'image':
      page.imageJpeg(slice.bytes, x + slice.dx, y, slice.width, slice.height);
      return;
    case 'rule': {
      const contentW = geom.pageWidth - geom.marginLeft - geom.marginRight;
      const w = slice.widthFraction * contentW;
      page.line(x, y + slice.height * 0.6, x + w, y + slice.height * 0.6, slice.color, slice.strokeWidth);
      return;
    }
    case 'table-row': {
      const tableW = slice.colWidths.reduce((a, b) => a + b, 0);
      if (slice.fill) page.rect(x, y, tableW, slice.height, slice.fill);
      let cellX = x;
      for (let c = 0; c < slice.cells.length; c++) {
        const cell = slice.cells[c]!;
        let lineY = y + slice.padding;
        for (const line of cell.lines) {
          drawLine(page, line, cellX + slice.padding, lineY, fonts);
          lineY += line.height;
        }
        if (slice.borders === 'all') {
          page.strokeRect(cellX, y, slice.colWidths[c]!, slice.height, slice.borderColor, 0.5);
        }
        cellX += slice.colWidths[c]!;
      }
      if (slice.borders === 'horizontal') {
        if (slice.header) {
          page.line(x, y, x + tableW, y, slice.borderColor, 0.7);
          page.line(x, y + slice.height, x + tableW, y + slice.height, slice.borderColor, 0.7);
        } else {
          page.line(x, y + slice.height, x + tableW, y + slice.height, slice.borderColor, 0.4);
        }
      }
      return;
    }
  }
}

function drawLine(page: CorePage, line: LayoutLine, x: number, y: number, fonts: FontRegistry): void {
  for (const run of line.runs) {
    const resolved = fonts.resolve(run.font);
    page.text(run.text, x + line.x + run.x, y + line.baseline - run.dy, {
      font: resolved.ref,
      size: run.size,
      color: run.color,
    });
  }
}

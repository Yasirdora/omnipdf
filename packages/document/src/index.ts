export { LayoutDocument } from './document.js';
export type {
  LayoutDocumentOptions,
  PageMargins,
  PageSize,
  TableDef,
} from './document.js';

export { FontRegistry, Measurer } from './measurer.js';
export type { FontSource, ResolvedFont } from './measurer.js';

export { breakLines, tokenize } from './line-break.js';
export type { StyledRun, BreakOptions } from './line-break.js';

export {
  ParagraphBlock,
  SpacerBlock,
  PageBreakBlock,
  ImageBlock,
} from './blocks.js';
export type { Block, LayoutContext, ImageBlockOpts } from './blocks.js';

export { TableBlock, resolveColumns } from './table.js';
export type { ColumnSpec, ResolvedTableStyle, TableBlockOpts } from './table.js';

export { paginate } from './paginator.js';
export type { PageGeometry, PaginationContext } from './paginator.js';

export { renderPages } from './render.js';
export type { FurnitureFn, FurnitureContext, RenderOptions } from './render.js';

export { NonConvergenceError } from './types.js';
export type {
  Align,
  BlockProps,
  CellLayout,
  LayoutLine,
  PageLayout,
  ParagraphStyle,
  Placement,
  PositionedRun,
  ResolvedParagraphStyle,
  Role,
  Slice,
  TextRun,
} from './types.js';

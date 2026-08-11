/**
 * OmniPDF document API: pages, text, shapes, JPEG images, link annotations,
 * outline bookmarks, file attachments, and metadata — assembled into a
 * deterministic, valid PDF 1.7 file.
 *
 * Coordinate system: top-left origin, y grows downward (converted internally
 * to PDF's bottom-left space). All sizes in PostScript points (1/72 inch).
 */
import { PdfWriter, ascii, concatBytes, fx } from './writer.js';
import { encodePdfString, encodePdfStringUtf16, encodeWinAnsi } from './encoding/winansi.js';
import { getFontMetrics, STANDARD_FONTS, type StandardFontName } from './fonts/standard.js';

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  /**
   * Opt-in timestamps. Omit (default) for deterministic output — the same
   * document built twice yields identical bytes.
   */
  creationDate?: Date;
  modDate?: Date;
}

export interface DocumentOptions extends DocumentMetadata {
  /** Compress content streams (default true, deterministic deflate). */
  compress?: boolean;
}

export interface TextOptions {
  font?: StandardFontName;
  size?: number;
  color?: string;
  /** Horizontal alignment against `width` (requires width). Default left. */
  align?: 'left' | 'center' | 'right';
  /** Reference width for alignment, in points. */
  width?: number;
  charSpacing?: number;
  /** Kerning (AFM) applied to alignment measurement; rendering itself is viewer-side. Default true. */
  kern?: boolean;
}

export interface OutlineItem {
  title: string;
  page: Page;
  /** Vertical position (top-left coords) the bookmark jumps to; default = top of page. */
  y?: number;
  children?: OutlineItem[];
}

interface ImageRef {
  objNum: number;
  index: number; // 1-based /ImN resource index
  width: number;
  height: number;
  bytes: Uint8Array;
}

interface LinkAnnot {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
}

const DEFAULT_PRODUCER = 'OmniPDF Core';

export class Document {
  private pages: Page[] = [];
  private fonts = new Map<StandardFontName, string>(); // font name -> resource key (F1…)
  private images: ImageRef[] = [];
  private outlines: OutlineItem[] = [];
  private attachments: Array<{ name: string; data: Uint8Array; mime?: string; description?: string }> = [];
  private meta: DocumentMetadata;
  private compress: boolean;

  constructor(opts?: DocumentOptions) {
    const { compress, ...meta } = opts ?? {};
    this.meta = meta;
    this.compress = compress ?? true;
  }

  /** Add a page. Defaults to A4 (595.28 × 841.89 pt). */
  addPage(width = 595.28, height = 841.89): Page {
    const page = new Page(this, width, height);
    this.pages.push(page);
    return page;
  }

  /** Register (idempotently) a base-14 font; returns its resource key. */
  registerFont(name: StandardFontName): string {
    let key = this.fonts.get(name);
    if (!key) {
      if (!STANDARD_FONTS.includes(name)) throw new Error(`Unknown base-14 font: ${name}`);
      key = `F${this.fonts.size + 1}`;
      this.fonts.set(name, key);
      getFontMetrics(name); // validates eagerly
    }
    return key;
  }

  /** Register a JPEG image; returns an internal reference. */
  registerJpeg(bytes: Uint8Array): ImageRef {
    const { width, height } = parseJpegSize(bytes);
    const ref: ImageRef = { objNum: -1, index: this.images.length + 1, width, height, bytes: new Uint8Array(bytes) };
    this.images.push(ref);
    return ref;
  }

  /** Attach an arbitrary file (round-trip payloads, source data, CSVs…). */
  attach(name: string, data: Uint8Array, opts?: { mime?: string; description?: string }): void {
    this.attachments.push({ name, data: new Uint8Array(data), mime: opts?.mime, description: opts?.description });
  }

  /** Set the document outline (bookmarks sidebar). */
  setOutlines(items: OutlineItem[]): void {
    this.outlines = items;
  }

  /** Serialize to a deterministic Uint8Array. Safe to call multiple times. */
  build(): Uint8Array {
    const w = new PdfWriter();

    // --- allocate core objects in a fixed order ---
    const catalogObj = w.allocate();
    const pagesObj = w.allocate();
    const infoObj = w.allocate();
    const xmpObj = w.allocate();

    const fontObjs = new Map<string, number>();
    for (const key of this.fonts.values()) fontObjs.set(key, w.allocate());

    for (const img of this.images) img.objNum = w.allocate();

    const contentObjs: number[] = [];
    const pageObjs: number[] = [];
    const annotObjNums: number[][] = [];
    for (const page of this.pages) {
      pageObjs.push(w.allocate());
      contentObjs.push(w.allocate());
      annotObjNums.push(page.links.map(() => w.allocate()));
    }

    const outlineRoot = this.outlines.length > 0 ? w.allocate() : 0;
    const outlineObjs: number[] = [];
    if (outlineRoot) {
      const flatCount = countOutlines(this.outlines);
      for (let i = 0; i < flatCount; i++) outlineObjs.push(w.allocate());
    }

    const namesObj = this.attachments.length > 0 ? w.allocate() : 0;
    const attachmentObjs = this.attachments.map(() => w.allocate()); // EmbeddedFile streams
    const filespecObjs = this.attachments.map(() => w.allocate()); // Filespec dicts referencing them

    // --- shared resource dictionary ---
    const fontRes = [...this.fonts.entries()]
      .map(([name, key]) => `/${key} ${fontObjs.get(key)} 0 R`)
      .join(' ');
    const imgRes = this.images
      .map((img, i) => `/Im${i + 1} ${img.objNum} 0 R`)
      .join(' ');
    const resources =
      `<<${fontRes ? ` /Font << ${fontRes} >>` : ''}${imgRes ? ` /XObject << ${imgRes} >>` : ''} >>`;

    // --- catalog / pages tree ---
    const namesPart = namesObj ? ` /Names ${namesObj} 0 R /AF [${filespecObjs.map((n) => `${n} 0 R`).join(' ')}]` : '';
    const outlinePart = outlineRoot ? ` /Outlines ${outlineRoot} 0 R /PageMode /UseOutlines` : '';
    w.setObject(
      catalogObj,
      `<< /Type /Catalog /Pages ${pagesObj} 0 R /Metadata ${xmpObj} 0 R${outlinePart}${namesPart} >>`,
    );
    w.setObject(
      pagesObj,
      `<< /Type /Pages /Kids [${pageObjs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`,
    );

    // --- info + XMP ---
    w.setObject(infoObj, buildInfoDict(this.meta));
    w.setStreamObject(xmpObj, ' /Type /Metadata /Subtype /XML', ascii(buildXmp(this.meta)), { compress: false });

    // --- fonts ---
    for (const [name, key] of this.fonts.entries()) {
      const encoding = getFontMetrics(name).isLatin ? ' /Encoding /WinAnsiEncoding' : '';
      w.setObject(fontObjs.get(key)!, `<< /Type /Font /Subtype /Type1 /BaseFont /${name}${encoding} >>`);
    }

    // --- images (JPEG streams keep their native DCT encoding) ---
    this.images.forEach((img) => {
      w.setStreamObject(
        img.objNum,
        ` /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8`,
        img.bytes,
        { compress: false, rawFilter: 'DCTDecode' },
      );
    });

    // --- pages & content ---
    this.pages.forEach((page, i) => {
      const annots = annotObjNums[i]!;
      const annotPart = annots.length ? ` /Annots [${annots.map((n) => `${n} 0 R`).join(' ')}]` : '';
      w.setObject(
        pageObjs[i]!,
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${fx(page.width)} ${fx(page.height)}] /Resources ${resources} /Contents ${contentObjs[i]} 0 R${annotPart} >>`,
      );
      w.setStreamObject(contentObjs[i]!, '', ascii(page.content.join('\n')), { compress: this.compress });

      page.links.forEach((link, j) => {
        const x1 = link.x;
        const y1 = page.height - link.y - link.h;
        const x2 = link.x + link.w;
        const y2 = page.height - link.y;
        w.setObject(
          annots[j]!,
          `<< /Type /Annot /Subtype /Link /Rect [${fx(x1)} ${fx(y1)} ${fx(x2)} ${fx(y2)}] /Border [0 0 0] /A << /S /URI /URI ${encodePdfString(link.url)} >> >>`,
        );
      });
    });

    // --- outlines ---
    if (outlineRoot) {
      const flat = flattenOutlines(this.outlines, pageObjs, this.pages);
      flat.forEach((node, idx) => {
        const parts: string[] = [
          `/Title ${encodePdfStringUtf16(node.title)}`,
          `/Parent ${node.parent === -1 ? outlineRoot : outlineObjs[node.parent]} 0 R`,
        ];
        if (node.prev >= 0) parts.push(`/Prev ${outlineObjs[node.prev]} 0 R`);
        if (node.next >= 0) parts.push(`/Next ${outlineObjs[node.next]} 0 R`);
        if (node.children.length > 0) {
          const descendants = subtreeSize(flat, idx) - 1;
          parts.push(
            `/First ${outlineObjs[node.children[0]!]} 0 R /Last ${outlineObjs[node.children[node.children.length - 1]!]} 0 R /Count ${descendants}`,
          );
        }
        parts.push(`/Dest [${node.pageObj} 0 R /XYZ null ${fx(node.destY)} null]`);
        w.setObject(outlineObjs[idx]!, `<< ${parts.join(' ')} >>`);
      });
      const tops = flat.map((_, i) => i).filter((i) => flat[i]!.parent === -1);
      w.setObject(
        outlineRoot,
        `<< /Type /Outlines /First ${outlineObjs[tops[0]!]} 0 R /Last ${outlineObjs[tops[tops.length - 1]!]} 0 R /Count ${flat.length} >>`,
      );
    }

    // --- attachments ---
    if (namesObj) {
      const entries = this.attachments
        .map((a, i) => `${encodePdfString(a.name)} ${filespecObjs[i]} 0 R`)
        .join(' ');
      w.setObject(namesObj, `<< /EmbeddedFiles << /Names [${entries}] >> >>`);
      this.attachments.forEach((a, i) => {
        const mime = a.mime ? ` /Subtype /${a.mime.replace('/', '#2F')}` : '';
        const params = ` /Params << /Size ${a.data.length} >>`;
        const desc = a.description ? ` /Desc ${encodePdfString(a.description)}` : '';
        w.setObject(
          filespecObjs[i]!,
          `<< /Type /Filespec /F ${encodePdfString(a.name)} /UF ${encodePdfStringUtf16(a.name)}${desc} /EF << /F ${attachmentObjs[i]} 0 R /UF ${attachmentObjs[i]} 0 R >> >>`,
        );
        w.setStreamObject(attachmentObjs[i]!, ` /Type /EmbeddedFile${mime}${params}`, a.data, { compress: this.compress });
      });
    }

    return w.build(catalogObj, infoObj);
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export class Page {
  readonly width: number;
  readonly height: number;
  /** @internal */ readonly content: string[] = [];
  /** @internal */ readonly links: LinkAnnot[] = [];
  private doc: Document;

  constructor(doc: Document, width: number, height: number) {
    this.doc = doc;
    this.width = width;
    this.height = height;
  }

  /** Draw text. y is the baseline, measured from the top of the page. */
  text(str: string, x: number, y: number, opts?: TextOptions): this {
    const fontName = opts?.font ?? 'Helvetica';
    const size = opts?.size ?? 12;
    const color = opts?.color ?? '#000000';
    const key = this.doc.registerFont(fontName);
    const metrics = getFontMetrics(fontName);

    let tx = x;
    const align = opts?.align ?? 'left';
    if (align !== 'left') {
      if (opts?.width === undefined) throw new Error('text align requires a width');
      const tw = metrics.widthAt(str, size, { kern: opts?.kern ?? true, charSpacing: opts?.charSpacing ?? 0 });
      tx = align === 'right' ? x + opts.width - tw : x + (opts.width - tw) / 2;
    }

    const cs = opts?.charSpacing ? `${fx(opts.charSpacing)} Tc ` : '';
    this.content.push(
      `BT /${key} ${fx(size)} Tf ${pdfColor(color)} rg ${cs}${fx(tx)} ${fx(this.height - y)} Td ${encodePdfString(str)} Tj ET`,
    );
    return this;
  }

  /** Filled rectangle (top-left coords). */
  rect(x: number, y: number, w: number, h: number, fill: string): this {
    this.content.push(`${pdfColor(fill)} rg ${fx(x)} ${fx(this.height - y - h)} ${fx(w)} ${fx(h)} re f`);
    return this;
  }

  /** Stroked line. */
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1): this {
    this.content.push(
      `${pdfColor(stroke)} RG ${fx(width)} w ${fx(x1)} ${fx(this.height - y1)} m ${fx(x2)} ${fx(this.height - y2)} l S`,
    );
    return this;
  }

  /** Place a JPEG image (natural size read from the file; scaled to w × h). */
  imageJpeg(bytes: Uint8Array, x: number, y: number, w: number, h: number): this {
    const ref = this.doc.registerJpeg(bytes);
    this.content.push(`q ${fx(w)} 0 0 ${fx(h)} ${fx(x)} ${fx(this.height - y - h)} cm /Im${ref.index} Do Q`);
    return this;
  }

  /** Clickable link rectangle (top-left coords). Optional visual underline. */
  link(url: string, x: number, y: number, w: number, h: number, opts?: { underline?: string }): this {
    this.links.push({ url, x, y, w, h });
    if (opts?.underline) this.line(x, y + h, x + w, y + h, opts.underline, 0.7);
    return this;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`invalid color ${JSON.stringify(hex)} — expected #rrggbb`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function pdfColor(hex: string): string {
  return hexToRgb(hex)
    .map((v) => fx(v / 255))
    .join(' ');
}

/** Parse JPEG SOF marker for intrinsic dimensions. */
export function parseJpegSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG (missing SOI)');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    // SOF0–SOF15 except DHT(0xC4), JPG(0xC8), DAC(0xCC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return { width, height };
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    i += 2 + len;
  }
  throw new Error('not a JPEG (no SOF marker found)');
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

function buildInfoDict(meta: DocumentMetadata): string {
  const parts: string[] = [];
  if (meta.title) parts.push(`/Title ${encodePdfStringUtf16(meta.title)}`);
  if (meta.author) parts.push(`/Author ${encodePdfStringUtf16(meta.author)}`);
  if (meta.subject) parts.push(`/Subject ${encodePdfStringUtf16(meta.subject)}`);
  if (meta.keywords?.length) parts.push(`/Keywords ${encodePdfStringUtf16(meta.keywords.join(', '))}`);
  if (meta.creator) parts.push(`/Creator ${encodePdfStringUtf16(meta.creator)}`);
  parts.push(`/Producer ${encodePdfStringUtf16(meta.producer ?? DEFAULT_PRODUCER)}`);
  if (meta.creationDate) parts.push(`/CreationDate ${pdfDate(meta.creationDate)}`);
  if (meta.modDate) parts.push(`/ModDate ${pdfDate(meta.modDate)}`);
  return `<< ${parts.join(' ')} >>`;
}

function xmpEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildXmp(meta: DocumentMetadata): string {
  const rows: string[] = [];
  if (meta.title) rows.push(`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmpEscape(meta.title)}</rdf:li></rdf:Alt></dc:title>`);
  if (meta.author) rows.push(`<dc:creator><rdf:Seq><rdf:li>${xmpEscape(meta.author)}</rdf:li></rdf:Seq></dc:creator>`);
  if (meta.subject) rows.push(`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmpEscape(meta.subject)}</rdf:li></rdf:Alt></dc:description>`);
  if (meta.creator) rows.push(`<xmp:CreatorTool>${xmpEscape(meta.creator)}</xmp:CreatorTool>`);
  rows.push(`<pdf:Producer>${xmpEscape(meta.producer ?? DEFAULT_PRODUCER)}</pdf:Producer>`);
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">`,
    rows.join('\n'),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// outline flattening
// ---------------------------------------------------------------------------

interface FlatOutline {
  title: string;
  pageObj: number;
  destY: number;
  /** Index of parent node, or -1 for top level. */
  parent: number;
  /** Indices of direct children. */
  children: number[];
  /** Index of previous/next sibling, or -1. */
  prev: number;
  next: number;
}

function subtreeSize(flat: FlatOutline[], idx: number): number {
  let size = 1;
  for (const c of flat[idx]!.children) size += subtreeSize(flat, c);
  return size;
}

function countOutlines(items: OutlineItem[]): number {
  return items.reduce((s, it) => s + 1 + (it.children ? countOutlines(it.children) : 0), 0);
}

function flattenOutlines(items: OutlineItem[], pageObjs: number[], pages: Page[]): FlatOutline[] {
  const out: FlatOutline[] = [];

  const walk = (list: OutlineItem[], parent: number): number[] => {
    const indices: number[] = [];
    for (const item of list) {
      const pageIndex = pages.indexOf(item.page);
      if (pageIndex < 0) throw new Error(`outline ${JSON.stringify(item.title)} references a page not in this document`);
      const idx = out.length;
      out.push({
        title: item.title,
        pageObj: pageObjs[pageIndex]!,
        destY: item.page.height - (item.y ?? 0),
        parent,
        children: [],
        prev: -1,
        next: -1,
      });
      indices.push(idx);
      out[idx]!.children = item.children?.length ? walk(item.children, idx) : [];
    }
    indices.forEach((idx, i) => {
      out[idx]!.prev = i > 0 ? indices[i - 1]! : -1;
      out[idx]!.next = i < indices.length - 1 ? indices[i + 1]! : -1;
    });
    return indices;
  };

  walk(items, -1);
  return out;
}

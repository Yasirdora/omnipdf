# OmniPDF Core

**Zero-dependency, deterministic PDF writer for every JavaScript runtime.**
The foundation of the OmniPDF universal document engine.

```bash
npm install @omnipdf/core
```

```typescript
import { Document } from '@omnipdf/core';

const doc = new Document({ title: 'Hello' });
const page = doc.addPage(); // A4
page.text('Hello, OmniPDF!', 48, 48, { size: 24, color: '#0f766e' });
page.rect(48, 80, 200, 4, '#0f766e');
page.link('https://github.com/omnipdf', 48, 100, 150, 14, { underline: '#0066cc' });

const bytes: Uint8Array = doc.build(); // a valid, deterministic PDF file
```

## What Phase 0 (this package) includes

| Capability | Notes |
|---|---|
| **Valid PDF 1.7 writer** | Object allocator, xref table, trailer. Validated externally with pypdf. |
| **Deterministic output** | Same input → same bytes, on Node, browsers, Deno, workers. Own fixed-Huffman deflate (RFC 1950/51) — no platform zlib variance. No `/ID`, no timestamps unless you opt in. |
| **Base-14 fonts with real AFM metrics** | All 14 standard fonts, Adobe AFM width tables + 19k kerning pairs. Alignment math you can trust. |
| **Text / shapes** | WinAnsi text with proper escaping, hex colors, char spacing, left/center/right alignment, rects, lines. Top-left origin coordinates. |
| **JPEG images** | Native DCTDecode embedding, intrinsic size parsing. |
| **Link annotations & outline bookmarks** | Clickable URLs; nested document outline with destinations. |
| **File attachments** | Proper `/Filespec` + `/EF` + `/Names` + `/AF` — the "living PDF" primitive: PDFs that carry their own source. |
| **Metadata** | Info dictionary + XMP packet (UTF-16/UTF-8, no dates by default). |

## Design guarantees

- **Zero runtime dependencies.** Nothing to audit, nothing to churn. Dev tooling only (TypeScript, tsup, vitest).
- **Byte determinism.** Verified by test: `doc.build()` twice → identical `Uint8Array`. Determinism opt-outs (timestamps) are explicit API choices.
- **Runtime universal.** Only `Uint8Array` and `TextEncoder` — no DOM, no Node APIs, no wasm.
- **Honest errors.** Unsupported characters throw `UnsupportedCharacterError` with the code point — no silent tofu. (Embedded TTF fonts for full Unicode land in Phase 1.)

## Known scope limits (by design)

- Base-14 fonts only, WinAnsi encoding only (Latin scripts). TTF embedding + subsetting: Phase 1.
- JPEG only for images. PNG (FlateDecode + SMask): Phase 1.
- No layout engine yet — this package is the writer. The block/pagination layer (`@omnipdf/document`) builds on it.
- Bundle size note: the full AFM metrics set (incl. 19k kern pairs) dominates the current bundle. A byte-indexed, tree-shakeable metrics layout is planned before 1.0.

## API summary

```typescript
const doc = new Document({
  title?, author?, subject?, keywords?, creator?, producer?,
  creationDate?, modDate?,      // opt-in; omitted for determinism
  compress? = true,             // deterministic deflate
});

const page = doc.addPage(width? = 595.28, height? = 841.89);
page.text(str, x, y, { font?, size?, color?, align?, width?, charSpacing?, kern? });
page.rect(x, y, w, h, fill);
page.line(x1, y1, x2, y2, stroke, width?);
page.imageJpeg(bytes, x, y, w, h);
page.link(url, x, y, w, h, { underline? });

doc.setOutlines([{ title, page, y?, children? }]);
doc.attach(name, bytes, { mime?, description? });
doc.build(): Uint8Array;         // idempotent
```

Font metrics are public too:

```typescript
import { getFontMetrics } from '@omnipdf/core';
getFontMetrics('Helvetica').widthAt('Hello', 12);  // exact points, AFM kerning
```

## Development

```bash
npm install          # at repo root (npm workspaces)
npm test             # vitest: deflate, encoding, writer, fonts, document, determinism
npm run typecheck
npm run build
npm run example      # writes packages/core/examples/invoice.pdf
```

Font metrics regeneration (requires network, Adobe AFM sources via foliojs/pdfkit):

```bash
node packages/core/scripts/build-afm-data.mjs
```

## License

MIT

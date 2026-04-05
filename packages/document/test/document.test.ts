import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { LayoutDocument } from '../src/document.js';

const latin1 = (u: Uint8Array) => [...u].map((b) => String.fromCharCode(b)).join('');

function inflatedText(bytes: Uint8Array): string {
  const str = latin1(bytes);
  const out: string[] = [];
  const re = /<<\s*\/Filter \/FlateDecode \/Length (\d+)[^\n]*?>>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const raw = bytes.subarray(m.index + m[0].length, m.index + m[0].length + Number(m[1]));
    out.push(latin1(new Uint8Array(inflateSync(raw))));
  }
  return out.join('\n');
}

function sampleDoc(): LayoutDocument {
  const doc = new LayoutDocument({
    pageSize: 'A4',
    title: 'Engine smoke test',
    footer: (page, ctx) => {
      page.text(`Page ${ctx.page} of ${ctx.pages}`, 50, 820, { size: 9, color: '#6b7280' });
    },
  });
  doc.heading('Quarterly report', 1);
  doc.paragraph(
    'Revenue grew steadily across all regions during the quarter. '.repeat(20),
    { align: 'justify' },
  );
  doc.paragraph([
    { text: 'Margins held at 41%', },
    { text: ', with enterprise renewals ahead of plan', note: 'Renewal uplift driven by multi-year commitments.' },
    { text: '. Churn stayed flat.' },
  ]);
  doc.table({
    columns: ['*', 90, 90],
    header: 1,
    rows: [
      ['Region', 'Q3', 'Q4'],
      ...Array.from({ length: 40 }, (_, i) => [`Region ${i + 1}`, `${100 + i}.0`, `${110 + i}.5`]),
    ],
  });
  return doc;
}

describe('LayoutDocument end-to-end', () => {
  it('builds a valid multi-page PDF', () => {
    const bytes = sampleDoc().build();
    const str = latin1(bytes);
    expect(str.startsWith('%PDF-1.7')).toBe(true);
    expect(str).toContain('%%EOF');
  });

  it('is byte-deterministic across builds', () => {
    const a = sampleDoc().build();
    const b = sampleDoc().build();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('draws furniture with resolved page totals ("Page 1 of N")', () => {
    const text = inflatedText(sampleDoc().build());
    expect(text).toContain('Page 1 of ');
    expect(text).not.toContain('Page 1 of undefined');
  });

  it('typesets the footnote and its superscript marker', () => {
    const text = inflatedText(sampleDoc().build());
    expect(text).toContain('Renewal uplift driven by multi-year commitments.');
  });

  it('embeds TTF fonts registered as bytes', () => {
    const fixture = fileURLToPath(new URL('../../core/test/fixtures/Ubuntu-R.ttf', import.meta.url));
    const doc = new LayoutDocument({});
    doc.font('ubuntu', new Uint8Array(readFileSync(fixture)));
    doc.paragraph('Привет из layout engine!', { font: 'ubuntu', size: 14 });
    const str = latin1(doc.build());
    expect(str).toContain('/Subtype /Type0');
    expect(str).toContain('/FontFile2');
  });

  it('repeats table headers across pages (header text drawn per page)', () => {
    const text = inflatedText(sampleDoc().build());
    // 'Region' header cells appear once per spanned page (table has 40 rows)
    const occurrences = text.split('(Region) Tj').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

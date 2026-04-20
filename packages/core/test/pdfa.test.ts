import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document } from '../src/document.js';
import { buildSrgbIccProfile } from '../src/pdfa/icc.js';

const latin1 = (u: Uint8Array) => [...u].map((b) => String.fromCharCode(b)).join('');
const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./fixtures/Ubuntu-R.ttf', import.meta.url))),
);

describe('sRGB ICC profile', () => {
  const icc = buildSrgbIccProfile();

  it('is structurally valid: acsp signature, 9 tags, declared size matches', () => {
    expect(icc.length).toBeGreaterThan(500);
    expect(icc.length).toBeLessThan(1024);
    const view = new DataView(icc.buffer, icc.byteOffset);
    expect(view.getUint32(0, false)).toBe(icc.length); // declared size
    expect(String.fromCharCode(icc[36]!, icc[37]!, icc[38]!, icc[39]!)).toBe('acsp');
    expect(String.fromCharCode(icc[12]!, icc[13]!, icc[14]!, icc[15]!)).toBe('mntr');
    expect(String.fromCharCode(icc[16]!, icc[17]!, icc[18]!, icc[19]!)).toBe('RGB ');
    expect(view.getUint32(128, false)).toBe(9); // tag count
    // every tag offset+size lands inside the file
    for (let i = 0; i < 9; i++) {
      const rec = 132 + i * 12;
      const off = view.getUint32(rec + 4, false);
      const size = view.getUint32(rec + 8, false);
      expect(off + size).toBeLessThanOrEqual(icc.length);
    }
  });

  it('is byte-deterministic', () => {
    expect(Buffer.from(buildSrgbIccProfile()).equals(Buffer.from(icc))).toBe(true);
  });
});

describe('PDF/A-3 mode', () => {
  function pdfaDoc(): Document {
    const doc = new Document({ pdfa: '3B', title: 'PDF/A test' });
    const font = doc.embedFont(fixture);
    const page = doc.addPage();
    page.text('PDF/A-3B smoke', 50, 60, { font, size: 14 });
    return doc;
  }

  it('adds an OutputIntent with the ICC profile to the catalog', () => {
    const pdf = latin1(pdfaDoc().build());
    expect(pdf).toContain('/OutputIntents [');
    expect(pdf).toContain('/Type /OutputIntent /S /GTS_PDFA1');
    expect(pdf).toContain('/N 3 /Alternate /DeviceRGB');
  });

  it('marks the XMP with pdfaid part 3 / conformance B', () => {
    const pdf = latin1(pdfaDoc().build());
    expect(pdf).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(pdf).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(pdf).toContain('xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"');
  });

  it('3U marks conformance U', () => {
    const doc = new Document({ pdfa: '3U' });
    const font = doc.embedFont(fixture);
    doc.addPage().text('x', 10, 10, { font });
    expect(latin1(doc.build())).toContain('<pdfaid:conformance>U</pdfaid:conformance>');
  });

  it('injects XMP extension fragments (Factur-X hook)', () => {
    const doc = new Document({
      pdfa: '3B',
      xmpExtensions: ['<fx:DocumentType xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">INVOICE</fx:DocumentType>'],
    });
    const font = doc.embedFont(fixture);
    doc.addPage().text('x', 10, 10, { font });
    expect(latin1(doc.build())).toContain('<fx:DocumentType xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">INVOICE</fx:DocumentType>');
  });

  it('rejects base-14 fonts in PDF/A mode with a clear error', () => {
    const doc = new Document({ pdfa: '3B' });
    doc.addPage().text('no embed', 10, 10, { font: 'Helvetica' });
    expect(() => doc.build()).toThrow(/PDF\/A-3B requires every font to be embedded/);
  });

  it('writes AFRelationship on filespec dicts', () => {
    const doc = pdfaDoc();
    doc.attach('factur-x.xml', new TextEncoder().encode('<x/>'), {
      mime: 'text/xml',
      afRelationship: 'Alternative',
    });
    const pdf = latin1(doc.build());
    expect(pdf).toContain('/AFRelationship /Alternative');
    expect(pdf).toContain('/Subtype /text#2Fxml');
  });

  it('is byte-deterministic including the ICC profile', () => {
    const a = pdfaDoc().build();
    const b = pdfaDoc().build();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

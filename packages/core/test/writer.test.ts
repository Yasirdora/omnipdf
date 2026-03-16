import { describe, it, expect } from 'vitest';
import { PdfWriter } from '../src/writer.js';

const latin1 = (u: Uint8Array) => [...u].map((b) => String.fromCharCode(b)).join('');

describe('PdfWriter', () => {
  it('allocates sequential object numbers starting at 1', () => {
    const w = new PdfWriter();
    expect(w.allocate()).toBe(1);
    expect(w.allocate()).toBe(2);
  });

  it('refuses to build with undefined objects', () => {
    const w = new PdfWriter();
    w.allocate();
    expect(() => w.build(1)).toThrow(/never defined/);
  });

  it('emits a structurally valid file with correct xref offsets', () => {
    const w = new PdfWriter();
    const root = w.allocate();
    w.setObject(root, '<< /Type /Catalog >>');
    const bytes = w.build(root);
    const str = latin1(bytes);

    expect(str.startsWith('%PDF-1.7\n')).toBe(true);
    expect(str).toContain('1 0 obj\n<< /Type /Catalog >>\nendobj');

    // startxref must point at the xref keyword
    const sx = /startxref\n(\d+)/.exec(str)!;
    const at = Number(sx[1]);
    expect(str.slice(at, at + 4)).toBe('xref');

    // the xref entry for object 1 must point at "1 0 obj"
    const xrefLine = /xref\n0 2\n0000000000 65535 f \n(\d{10}) 00000 n/.exec(str)!;
    const objAt = Number(xrefLine[1]);
    expect(str.slice(objAt, objAt + 6)).toBe('1 0 ob');

    // deterministic trailer: no /ID, no dates
    expect(str).not.toContain('/ID');
    expect(str).not.toContain('CreationDate');
  });

  it('compresses stream objects with FlateDecode by default', () => {
    const w = new PdfWriter();
    const root = w.allocate();
    const s = w.allocate();
    w.setObject(root, '<< >>');
    w.setStreamObject(s, '', new TextEncoder().encode('hello hello hello hello'));
    const str = latin1(w.build(root));
    expect(str).toContain('/Filter /FlateDecode');
  });

  it('supports raw (uncompressed, pre-filtered) streams', () => {
    const w = new PdfWriter();
    const root = w.allocate();
    const s = w.allocate();
    w.setObject(root, '<< >>');
    w.setStreamObject(s, ' /Subtype /Image', new Uint8Array([1, 2, 3]), { compress: false, rawFilter: 'DCTDecode' });
    const str = latin1(w.build(root));
    expect(str).toContain('/Filter /DCTDecode');
    expect(str).toContain('/Length 3');
    expect(str).not.toContain('FlateDecode');
  });
});

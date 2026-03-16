/**
 * Low-level PDF file writer: object allocator, stream handling, cross-reference
 * table, trailer. Byte-exact, deterministic:
 *
 *  - objects are emitted in ascending object number
 *  - no /ID, no dates anywhere in the file
 *  - stream compression uses our own deterministic deflate (see deflate.ts)
 *
 * This class knows nothing about pages, fonts, or layout — it only serializes
 * the object graph it is handed. Determinism rule: callers must feed it the
 * same objects in the same order to get the same bytes.
 */
import { deflate } from './deflate.js';

const HEADER = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';

export class PdfWriter {
  /** 1-indexed object store; index 0 is always the free head. */
  private objects: Array<string | Uint8Array | null> = [null];

  /** Allocate an object number, to be filled later via setObject. */
  allocate(): number {
    this.objects.push(null);
    return this.objects.length - 1;
  }

  /** Define an object with a string or binary body (without the `n 0 obj` wrapper). */
  setObject(num: number, body: string | Uint8Array): void {
    if (num <= 0 || num >= this.objects.length) throw new RangeError(`object ${num} out of range`);
    this.objects[num] = body;
  }

  /** Define a stream object; compresses with FlateDecode unless disabled. */
  setStreamObject(
    num: number,
    dictEntries: string,
    data: Uint8Array,
    opts?: { compress?: boolean; rawFilter?: string },
  ): void {
    const compress = opts?.compress ?? true;
    const payload = compress ? deflate(data) : data;
    const filter = compress ? ' /Filter /FlateDecode' : opts?.rawFilter ? ` /Filter /${opts.rawFilter}` : '';
    const header = `<<${filter} /Length ${payload.length}${dictEntries}>>\nstream\n`;
    const body = concatBytes([ascii(header), payload, ascii('\nendstream')]);
    this.setObject(num, body);
  }

  /** Serialize the whole file. */
  build(root: number, info?: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const push = (u: Uint8Array): void => {
      chunks.push(u);
      offset += u.length;
    };
    const pushStr = (s: string): void => push(ascii(s));

    pushStr(HEADER);

    const offsets = new Array<number>(this.objects.length).fill(0);
    for (let n = 1; n < this.objects.length; n++) {
      const body = this.objects[n];
      if (body == null) throw new Error(`object ${n} was allocated but never defined`);
      offsets[n] = offset;
      pushStr(`${n} 0 obj\n`);
      push(typeof body === 'string' ? ascii(body) : body);
      pushStr('\nendobj\n');
    }

    const xrefAt = offset;
    let xref = `xref\n0 ${this.objects.length}\n`;
    xref += '0000000000 65535 f \n';
    for (let n = 1; n < this.objects.length; n++) {
      xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    xref += 'trailer\n';
    xref += `<< /Size ${this.objects.length} /Root ${root} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\n`;
    xref += `startxref\n${xrefAt}\n%%EOF\n`;
    pushStr(xref);

    const out = new Uint8Array(offset);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

export function ascii(s: string): Uint8Array {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Format a PDF number: integers plain, reals with up to 4 decimals, no trailing zeros. */
export function fx(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite PDF number: ${v}`);
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

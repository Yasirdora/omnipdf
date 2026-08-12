import { describe, it, expect } from 'vitest';
import { deflateSync, deflateRawSync, inflateSync } from 'node:zlib';
import { inflate, inflateZlib } from '../src/inflate.js';
import { deflate } from '../src/deflate.js';
import { Document } from '../src/document.js';
import { extractEmbeddedFiles, extractAttachment } from '../src/reader.js';

function pseudoRandom(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

describe('inflateZlib (zlib format — what deflate() and PDF FlateDecode use)', () => {
  it('roundtrips our own deflate output', () => {
    for (const data of [
      new TextEncoder().encode('hello hello hello world world'),
      pseudoRandom(1000, 42),
      pseudoRandom(70000, 7),
      new Uint8Array(500).fill(0),
    ]) {
      expect(Buffer.from(inflateZlib(deflate(data))).equals(Buffer.from(data))).toBe(true);
    }
  });

  it('decodes zlib-produced dynamic-Huffman streams', () => {
    const data = new TextEncoder().encode('The quick brown fox. '.repeat(500));
    const zipped = deflateSync(data);
    expect(Buffer.from(inflateZlib(new Uint8Array(zipped))).equals(Buffer.from(data))).toBe(true);
  });

  it('decodes zlib streams of incompressible data (stored blocks)', () => {
    const data = pseudoRandom(4096, 99);
    const zipped = deflateSync(data, { level: 0 }); // stored
    expect(Buffer.from(inflateZlib(new Uint8Array(zipped))).equals(Buffer.from(data))).toBe(true);
  });

  it('agrees byte-for-byte with zlib inflate on our output', () => {
    const data = pseudoRandom(50000, 3);
    const ours = inflateZlib(deflate(data));
    const theirs = inflateSync(Buffer.from(deflate(data)));
    expect(Buffer.from(ours).equals(theirs)).toBe(true);
  });

  it('verifies adler32 and rejects corrupt data', () => {
    const data = new TextEncoder().encode('check the checksum');
    const corrupted = deflate(data).slice();
    corrupted[corrupted.length - 1]! ^= 0xff;
    expect(() => inflateZlib(corrupted)).toThrow(/adler32/);
    expect(() => inflateZlib(new Uint8Array([1, 2, 3]))).toThrow(/too short/);
    expect(() => inflateZlib(new Uint8Array([0x78, 0x00, 0, 0, 0, 0]))).toThrow(/header check/);
  });
});

describe('inflate (raw DEFLATE)', () => {
  it('decodes raw streams from zlib', () => {
    const data = new TextEncoder().encode('raw deflate round trip '.repeat(200));
    const raw = deflateRawSync(data);
    expect(Buffer.from(inflate(new Uint8Array(raw))).equals(Buffer.from(data))).toBe(true);
  });

  it('honors expectedSize and rejects garbage', () => {
    const data = new TextEncoder().encode('check the size');
    expect(() => inflate(deflateRawSync(data), data.length + 1)).toThrow(/size mismatch/);
    expect(() => inflate(new Uint8Array([255, 255, 255, 255]))).toThrow();
  });
});

describe('extractEmbeddedFiles (round-trip restore)', () => {
  it('restores compressed attachments with names', () => {
    const doc = new Document();
    doc.addPage().text('payload carrier', 10, 10);
    const json = new TextEncoder().encode(JSON.stringify({ type: 'invoice', total: 2483.96 }));
    const csv = new TextEncoder().encode('a,b,c\n1,2,3\n'.repeat(100));
    doc.attach('document.json', json, { mime: 'application/json' });
    doc.attach('lines.csv', csv, { mime: 'text/csv' });
    const files = extractEmbeddedFiles(doc.build());
    expect(files.map((f) => f.name)).toEqual(['document.json', 'lines.csv']);
    expect(Buffer.from(files[0]!.data).equals(Buffer.from(json))).toBe(true);
    expect(Buffer.from(files[1]!.data).equals(Buffer.from(csv))).toBe(true);
  });

  it('extractAttachment returns a single named file', () => {
    const doc = new Document();
    doc.addPage();
    const payload = new TextEncoder().encode('{"hello":"world"}');
    doc.attach('document.json', payload);
    const restored = extractAttachment(doc.build(), 'document.json');
    expect(restored).not.toBeNull();
    expect(new TextDecoder().decode(restored!)).toBe('{"hello":"world"}');
    expect(extractAttachment(doc.build(), 'missing.json')).toBeNull();
  });

  it('handles special characters in attachment names', () => {
    const doc = new Document();
    doc.addPage();
    doc.attach('report (final) v2.json', new TextEncoder().encode('{}'));
    const files = extractEmbeddedFiles(doc.build());
    expect(files[0]!.name).toBe('report (final) v2.json');
  });
});

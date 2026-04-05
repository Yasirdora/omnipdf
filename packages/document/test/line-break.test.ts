import { describe, it, expect } from 'vitest';
import { FontRegistry, Measurer } from '../src/measurer.js';
import { breakLines, tokenize, type StyledRun } from '../src/line-break.js';

const registry = new FontRegistry();
const measurer = new Measurer(registry);

const run = (text: string, over: Partial<StyledRun> = {}): StyledRun => ({
  text,
  font: 'Helvetica',
  size: 12,
  color: '#000',
  ...over,
});

const opts = (width: number, align: 'left' | 'right' | 'center' | 'justify' = 'left') => ({
  widthAt: () => width,
  align,
  lineHeight: 1.25,
  fallback: { font: 'Helvetica', size: 12 },
});

describe('tokenize', () => {
  it('splits words and glue, preserving multiple spaces', () => {
    const tokens = tokenize([run('hello  world')], measurer);
    expect(tokens.map((t) => t.text)).toEqual(['hello', '  ', 'world']);
    expect(tokens[1]!.glue).toBe(true);
  });

  it('treats NBSP as part of the word', () => {
    const tokens = tokenize([run('10 kg')], measurer);
    expect(tokens.filter((t) => !t.glue).map((t) => t.text)).toEqual(['10 kg']);
  });

  it('emits forced breaks for newlines', () => {
    const tokens = tokenize([run('a\nb')], measurer);
    expect(tokens.some((t) => t.forcedBreak)).toBe(true);
  });

  it('appends a raised superscript marker for footnotes', () => {
    const tokens = tokenize([run('claim', { noteId: 3 })], measurer);
    const marker = tokens[tokens.length - 1]!;
    expect(marker.text).toBe('3');
    expect(marker.dy).toBeGreaterThan(0);
    expect(marker.size).toBeCloseTo(12 * 0.7);
    expect(marker.noteId).toBe(3);
  });
});

describe('breakLines', () => {
  const lorem = 'the quick brown fox jumps over the lazy dog and keeps running';

  it('wraps at the measured width', () => {
    const lines = breakLines([run(lorem)], measurer, opts(120));
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(line.width).toBeLessThanOrEqual(120 + 1e-6);
    }
    // no text lost
    expect(lines.flatMap((l) => l.runs.map((r) => r.text)).join(' ').replace(/\s+/g, ' ').trim())
      .toBe(lorem);
  });

  it('never loses text across many breaks', () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const lines = breakLines([run(words)], measurer, opts(150));
    const joined = lines.flatMap((l) => l.runs.map((r) => r.text)).join(' ');
    for (let i = 0; i < 200; i++) expect(joined).toContain(`word${i}`);
  });

  it('hard-splits overlong words (forward progress in narrow columns)', () => {
    const lines = breakLines([run('supercalifragilisticexpialidocious')], measurer, opts(60));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.width <= 60 + 1e-6)).toBe(true);
    expect(lines.flatMap((l) => l.runs.map((r) => r.text)).join('')).toBe(
      'supercalifragilisticexpialidocious',
    );
  });

  it('justifies by stretching glue, except the last line', () => {
    const lines = breakLines([run(lorem)], measurer, opts(140, 'justify'));
    const allButLast = lines.slice(0, -1);
    for (const line of allButLast) {
      const last = line.runs[line.runs.length - 1]!;
      expect(last.x + last.width).toBeCloseTo(140, 0);
    }
    const lastLine = lines[lines.length - 1]!;
    const lastRun = lastLine.runs[lastLine.runs.length - 1]!;
    expect(lastRun.x + lastRun.width).toBeLessThan(140);
  });

  it('right- and center-aligns within the line width', () => {
    const [r] = breakLines([run('hello')], measurer, opts(200, 'right'));
    const rr = r!.runs[r!.runs.length - 1]!;
    expect(rr.x + rr.width).toBeCloseTo(200, 1);
    const [c] = breakLines([run('hello')], measurer, opts(200, 'center'));
    const first = c!.runs[0]!;
    expect(first.x).toBeCloseTo((200 - c!.width) / 2, 1);
  });

  it('respects per-line width (first-line indent)', () => {
    const lines = breakLines([run(lorem)], measurer, {
      ...opts(200),
      widthAt: (i) => (i === 0 ? 80 : 200),
    });
    expect(lines[0]!.width).toBeLessThanOrEqual(80 + 1e-6);
  });

  it('tracks footnote ids per line', () => {
    const lines = breakLines([run('alpha', { noteId: 1 }), run(' beta')], measurer, opts(500));
    expect(lines[0]!.noteIds).toEqual([1]);
  });

  it('gives empty paragraphs a real line box', () => {
    const lines = breakLines([run('')], measurer, opts(200));
    expect(lines.length).toBe(1);
    expect(lines[0]!.height).toBeCloseTo(12 * 1.25);
  });

  it('aligns mixed-size runs on a common baseline', () => {
    const lines = breakLines([run('small '), run('BIG', { size: 24 })], measurer, opts(500));
    const line = lines[0]!;
    expect(line.height).toBeCloseTo(24 * 1.25);
    expect(line.baseline).toBeGreaterThan(0);
    expect(line.runs.length).toBe(2);
  });
});

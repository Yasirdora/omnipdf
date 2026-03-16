#!/usr/bin/env node
/**
 * Parses Adobe AFM files (scripts/afm/*.afm, sourced from the foliojs/pdfkit
 * redistribution of Adobe's Core-35 AFM metrics) and emits:
 *   src/fonts/afm-data.json
 *
 * Output shape:
 * {
 *   "fonts": {
 *     "Helvetica": {
 *       "glyphWidths": { "A": 667, ... },        // glyph name -> width (1/1000 em)
 *       "codeWidths":   { "65": 667, ... },      // native code  -> width (for Symbol/ZapfDingbats)
 *       "kernPairs":    { "A\0V": -70, ... },     // leftGlyph \0 rightGlyph -> kern
 *       "capHeight": 718, "xHeight": 523, "ascender": 718, "descender": -207,
 *       "italicAngle": 0, "underlinePosition": -100, "underlineThickness": 50
 *     }, ...
 *   }
 * }
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const afmDir = join(here, 'afm');
const outFile = join(here, '..', 'src', 'fonts', 'afm-data.json');

const fonts = {};

for (const file of readdirSync(afmDir).filter((f) => f.endsWith('.afm'))) {
  const text = readFileSync(join(afmDir, file), 'latin1');
  const glyphWidths = {};
  const codeWidths = {};
  const kernPairs = {};
  const metrics = {};

  const metricMatch = text.match(/StartFontMetrics[\s\S]*?EndFontMetrics/);
  if (!metricMatch) throw new Error(`No metrics section in ${file}`);
  const body = metricMatch[0];

  for (const key of ['CapHeight', 'XHeight', 'Ascender', 'Descender', 'ItalicAngle', 'UnderlinePosition', 'UnderlineThickness']) {
    const m = body.match(new RegExp(`^${key} (-?[\\d.]+)`, 'm'));
    if (m) metrics[key.toLowerCase()] = Number(m[1]);
  }

  const charSection = body.match(/StartCharMetrics[\s\S]*?EndCharMetrics/);
  if (charSection) {
    for (const line of charSection[0].split('\n')) {
      const c = line.match(/^C (-?\d+) ; WX (-?\d+) ; N (\S+)/);
      if (c) {
        const [, code, wx, name] = c;
        glyphWidths[name] = Number(wx);
        if (Number(code) >= 0) codeWidths[code] = Number(wx);
      }
    }
  }

  const kernSection = body.match(/StartKernPairs[\s\S]*?EndKernPairs/);
  if (kernSection) {
    for (const line of kernSection[0].split('\n')) {
      const k = line.match(/^KPX (\S+) (\S+) (-?\d+)/);
      if (k) kernPairs[`${k[1]} ${k[2]}`] = Number(k[3]);
    }
  }

  const fontName = file.replace(/\.afm$/, '');
  fonts[fontName] = { glyphWidths, codeWidths, kernPairs, ...metrics };
}

writeFileSync(outFile, JSON.stringify({ fonts }));
const totalKerns = Object.values(fonts).reduce((s, f) => s + Object.keys(f.kernPairs).length, 0);
console.log(`Wrote ${outFile}`);
console.log(`Fonts: ${Object.keys(fonts).length}, kern pairs: ${totalKerns}, bytes: ${JSON.stringify({ fonts }).length}`);

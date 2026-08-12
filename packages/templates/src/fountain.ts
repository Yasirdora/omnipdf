/**
 * Fountain parser (fountain.io): plain-text screenplays → structured elements.
 *
 * Covers the spec's core: title page, scene headings (INT./EXT. or forced '.'),
 * action, character cues + dialogue + parentheticals, dual dialogue ('^'),
 * transitions ('TO:' or forced '>'), centered text ('> <'), notes [[ ]],
 * boneyard (slash-star ... star-slash), page breaks (===), sections (#) and
 * synopses (=), lyrics (~), forced characters (@), scene numbers (#n#), hard
 * line breaks (two trailing spaces). Emphasis markers (*, **, _) are stripped —
 * Courier is deliberately uniform in screenplay tradition.
 */

export type FountainElement =
  | { type: 'scene'; text: string; sceneNumber?: string }
  | { type: 'action'; text: string }
  | { type: 'centered'; text: string }
  | {
      type: 'dialogue';
      character: string;
      /** True when the cue carried '^' — pairs with the previous dialogue. */
      dual: boolean;
      parts: Array<{ type: 'line' | 'parenthetical'; text: string }>;
    }
  | { type: 'transition'; text: string }
  | { type: 'pageBreak' }
  | { type: 'section'; level: number; text: string }
  | { type: 'synopsis'; text: string };

export interface FountainScript {
  /** Title-page fields, keys lowercased ('title', 'author', 'credit', ...). */
  titlePage: Record<string, string[]>;
  elements: FountainElement[];
}

const SCENE_RE = /^(INT|EXT|EST|INT\.\/EXT|INT\/EXT|I\/E)([. ]|$)/;
const TRANSITION_RE = /^[A-Z0-9 .'()-]+TO:$/;
const TITLE_KEY_RE = /^([A-Za-z][A-Za-z0-9 ]{1,20}):[ \t]?(.*)$/;

function isUpperCaseLine(s: string): boolean {
  return /[A-Z]/.test(s) && !/[a-z]/.test(s);
}

function stripMarkup(src: string): string {
  // boneyard (slash-star ... star-slash), then notes [[ ... ]] — both multiline
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[\[[\s\S]*?\]\]/g, '');
}

function stripEmphasis(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

/** Split off the title page: `Key: value` block at the very start, ended by a blank line. */
function splitTitlePage(lines: string[]): { titlePage: Record<string, string[]>; body: string[] } {
  const titlePage: Record<string, string[]> = {};
  if (lines.length === 0 || !TITLE_KEY_RE.test(lines[0]!)) return { titlePage, body: lines };
  let i = 0;
  let lastKey: string | null = null;
  while (i < lines.length) {
    const raw = lines[i]!;
    const m = TITLE_KEY_RE.exec(raw);
    if (m) {
      lastKey = m[1]!.trim().toLowerCase();
      titlePage[lastKey] = m[2]!.trim() ? [stripEmphasis(m[2]!.trim())] : [];
      i += 1;
      continue;
    }
    if (lastKey && raw.trim() && (raw.startsWith(' ') || raw.startsWith('\t') || titlePage[lastKey]!.length === 0)) {
      titlePage[lastKey]!.push(stripEmphasis(raw.trim()));
      i += 1;
      continue;
    }
    if (!raw.trim()) { i += 1; break; }
    break;
  }
  return { titlePage, body: lines.slice(i) };
}

export function parseFountain(source: string): FountainScript {
  const clean = stripMarkup(source.replace(/\r\n?/g, '\n'));
  const { titlePage, body } = splitTitlePage(clean.split('\n'));

  const elements: FountainElement[] = [];
  let dialogue: Extract<FountainElement, { type: 'dialogue' }> | null = null;
  let actionLines: Array<{ text: string; hard: boolean }> = [];

  const flushAction = () => {
    if (actionLines.length) {
      let text = actionLines[0]!.text;
      for (let i = 1; i < actionLines.length; i++) {
        text += (actionLines[i - 1]!.hard ? '\n' : ' ') + actionLines[i]!.text;
      }
      const trimmed = stripEmphasis(text.trim());
      if (trimmed) elements.push({ type: 'action', text: trimmed });
      actionLines = [];
    }
  };
  const flushDialogue = () => {
    if (dialogue) { elements.push(dialogue); dialogue = null; }
  };

  for (let li = 0; li < body.length; li++) {
    const raw = body[li]!;
    const hard = raw.endsWith('  ');
    const line = raw.trim();

    if (!line) { flushAction(); flushDialogue(); continue; }

    if (/^={3,}\s*$/.test(line)) {
      flushAction(); flushDialogue();
      elements.push({ type: 'pageBreak' });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flushAction(); flushDialogue();
      elements.push({
        type: 'section',
        level: line.indexOf(' '),
        text: line.replace(/^#+\s*/, '').replace(/#+$/, '').trim(),
      });
      continue;
    }
    if (/^=[^=]/.test(line)) {
      flushAction(); flushDialogue();
      elements.push({ type: 'synopsis', text: line.slice(1).trim() });
      continue;
    }

    if (dialogue) {
      if (line.startsWith('(')) dialogue.parts.push({ type: 'parenthetical', text: stripEmphasis(line) });
      else dialogue.parts.push({ type: 'line', text: stripEmphasis(line) });
      continue;
    }

    // centered: > text <
    if (line.startsWith('>') && line.endsWith('<') && line.length > 2) {
      flushAction();
      elements.push({ type: 'centered', text: stripEmphasis(line.slice(1, -1).trim()) });
      continue;
    }
    // transition: forced '>' or uppercase ... TO:
    if (line.startsWith('>') || TRANSITION_RE.test(line)) {
      flushAction();
      elements.push({ type: 'transition', text: stripEmphasis(line.replace(/^>/, '').trim()) });
      continue;
    }
    // scene heading: forced '.' or INT./EXT./...; trailing #number# is the scene number
    const forcedScene = line.startsWith('.');
    if (forcedScene || SCENE_RE.test(line)) {
      flushAction();
      let text = (forcedScene ? line.slice(1) : line).trim();
      let sceneNumber: string | undefined;
      const num = /#([^#]+)#\s*$/.exec(text);
      if (num) { sceneNumber = num[1]!; text = text.slice(0, num.index).trim(); }
      elements.push({ type: 'scene', text: stripEmphasis(text), ...(sceneNumber !== undefined ? { sceneNumber } : {}) });
      continue;
    }
    // character cue: forced '@', or an uppercase line followed by more text
    const forcedChar = line.startsWith('@');
    const bare = (forcedChar ? line.slice(1) : line).trim();
    const next = body[li + 1]?.trim();
    if (bare && (forcedChar || (isUpperCaseLine(bare) && !!next))) {
      flushAction();
      const dual = bare.endsWith('^');
      dialogue = {
        type: 'dialogue',
        character: (dual ? bare.slice(0, -1) : bare).trim(),
        dual,
        parts: [],
      };
      continue;
    }

    // action (lyrics '~' lose the marker and render as action)
    actionLines.push({ text: line.replace(/^~/, ''), hard });
  }
  flushAction();
  flushDialogue();

  return { titlePage, elements };
}

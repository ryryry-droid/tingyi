import { isChinese } from './types';

export type Token = { t: string; w: boolean };

const PUNCT = '\\s.,!?;:"“”‘’()\\[\\]{}…—–。，！？、；：「」『』（）《》〈〉·•/';
const WORD_RE = new RegExp(`[^${PUNCT}]+|[${PUNCT}]+`, 'g');
const IS_WORD = new RegExp(`[^${PUNCT}0-9]`);
// Written without spaces between words: split into characters when no segmenter is available
const CHAR_LANGS = ['zh', 'yue', 'ja', 'th', 'km'];

let segmenters: Record<string, any> = {};

/** Splits text into tokens; word tokens can be tapped. */
export function tokenize(text: string, lang: string): Token[] {
  const loc = isChinese(lang) ? 'zh' : lang;
  try {
    const Seg = (Intl as any).Segmenter;
    if (Seg) {
      segmenters[loc] = segmenters[loc] || new Seg(loc, { granularity: 'word' });
      return [...segmenters[loc].segment(text)].map((x: any) => ({ t: x.segment, w: !!x.isWordLike }));
    }
  } catch {
    segmenters = {};
  }
  // No word segmenter on this phone. Languages written without spaces are split into characters (the lookup
  // finds the whole word and the selection grows to match); the others at spaces and punctuation.
  if (CHAR_LANGS.includes(lang)) {
    const parts = text.match(new RegExp(`[^${PUNCT}]|[${PUNCT}]+`, 'g')) || [];
    // keep Latin words and numbers whole inside Chinese/Japanese text
    const out: Token[] = [];
    for (const t of parts) {
      const prev = out[out.length - 1];
      if (prev && /^[A-Za-z0-9]$/.test(t) && /^[A-Za-z0-9]+$/.test(prev.t)) prev.t += t;
      // Thai/Khmer vowel and tone marks belong to the letter before them
      else if (prev && prev.w && /^[ัิ-ฺ็-๎឴-៓̀-ͯ]$/.test(t)) prev.t += t;
      else out.push({ t, w: IS_WORD.test(t) });
    }
    return out;
  }
  return (text.match(WORD_RE) || []).map((t) => ({ t, w: IS_WORD.test(t) }));
}

export const isTappable = (tk: Token) => tk.w && !/^\d+$/.test(tk.t);

export const joinTokens = (tokens: Token[], a: number, b: number) =>
  tokens
    .slice(a, b + 1)
    .map((x) => x.t)
    .join('')
    .trim();

/** After a lookup returns a longer word (e.g. 周末 for 周), find the token range it covers around the tap. */
export function rangeFor(tokens: Token[], a: number, b: number, word: string): [number, number] {
  if (!word) return [a, b];
  const text = tokens.map((x) => x.t).join('');
  const starts: number[] = [];
  let pos = 0;
  for (const tk of tokens) {
    starts.push(pos);
    pos += tk.t.length;
  }
  const selStart = starts[a];
  const selEnd = starts[b] + tokens[b].t.length;
  let i = text.indexOf(word);
  while (i >= 0) {
    const end = i + word.length;
    if (i <= selStart && end >= selEnd) {
      const na = starts.findIndex((st, k) => st <= i && st + tokens[k].t.length > i);
      let nb = na;
      while (nb + 1 < tokens.length && starts[nb + 1] < end) nb++;
      if (na >= 0 && starts[na] === i && starts[nb] + tokens[nb].t.length === end) return [na, nb];
      return [a, b];
    }
    i = text.indexOf(word, i + 1);
  }
  return [a, b];
}

export const cleanWord = (t: string) =>
  String(t || '')
    .replace(/[。，！？、；：,.!?;:"“”'‘’()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------- choosing what to look up ----------
// The lookup card shows the sentence as characters (Chinese/Japanese/Thai/Khmer) or words; tapping them
// changes the selection. Selections are kept as indexes into these "pick" tokens.
const PICK_CHAR_LANGS = ['zh', 'yue', 'ja', 'th', 'km'];
const PUNCT_ONLY = new RegExp(`^[${PUNCT}]+$`);

export function pickTokens(text: string, lang: string): Token[] {
  if (!PICK_CHAR_LANGS.includes(lang)) return tokenize(text, lang);
  const out: Token[] = [];
  for (const ch of text) {
    const prev = out[out.length - 1];
    if (prev && /^[ัิ-ฺ็-๎឴-៓̀-ͯ]$/.test(ch)) prev.t += ch; // Thai/Khmer marks
    else if (prev && /^[A-Za-z0-9]$/.test(ch) && /^[A-Za-z0-9]+$/.test(prev.t)) prev.t += ch; // keep Latin words whole
    else out.push({ t: ch, w: !PUNCT_ONLY.test(ch) });
  }
  return out;
}
export const pickByChar = (lang: string) => PICK_CHAR_LANGS.includes(lang);

export function offsets(tokens: Token[]): number[] {
  let o = 0;
  return tokens.map((x) => {
    const s = o;
    o += x.t.length;
    return s;
  });
}

/** Pick range covering main token k. */
export function picksFor(mains: Token[], k: number, picks: Token[]): [number, number] {
  const mo = offsets(mains);
  const po = offsets(picks);
  const from = mo[k];
  const to = mo[k] + mains[k].t.length;
  let a = po.findIndex((s, j) => s + picks[j].t.length > from);
  if (a < 0) a = 0;
  let b = a;
  while (b + 1 < picks.length && po[b + 1] < to) b++;
  return [a, b];
}

/** Main tokens overlapping the picked range (for highlighting the transcript). */
export function mainsFor(mains: Token[], picks: Token[], a: number, b: number): [number, number] | null {
  const mo = offsets(mains);
  const po = offsets(picks);
  const from = po[a];
  const to = po[b] + picks[b].t.length;
  let first = -1;
  let last = -1;
  mains.forEach((m, k) => {
    if (mo[k] < to && mo[k] + m.t.length > from) {
      if (first < 0) first = k;
      last = k;
    }
  });
  return first < 0 ? null : [first, last];
}

/** Tapping a pick token: extend to it, trim an end, or start again from it. Returns the new range. */
export function tapPick(picks: Token[], a: number, b: number, k: number): [number, number] {
  if (!picks[k]?.w) return [a, b];
  if (k < a) a = k;
  else if (k > b) b = k;
  else if (a === b) return [a, b];
  else if (k === a) a++;
  else if (k === b) b--;
  else a = b = k;
  while (joinTokens(picks, a, b).length > 30 && a < b) {
    if (k <= a) b--;
    else a++;
  }
  return [a, b];
}

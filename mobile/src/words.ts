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

const STOP = /[。，！？、；：,.!?;:]/;

/** Index of the next word token in a direction, or -1 (stops at punctuation). */
export function nextWord(tokens: Token[], from: number, dir: 1 | -1): number {
  let j = from + dir;
  while (j >= 0 && j < tokens.length && !tokens[j].w) {
    if (STOP.test(tokens[j].t)) return -1;
    j += dir;
  }
  return j >= 0 && j < tokens.length ? j : -1;
}

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

import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchBank } from './api';
import { BankTerm, Settings } from './types';

// The Singapore Mandarin word bank. The app ships with a copy; newer terms come from the server
// (so terms added later appear without updating the app), and the last copy is kept for offline use.
const BUNDLED: BankTerm[] = require('../assets/sgm.json');
const CACHE_KEY = 'chattalk.sgm.v1';
const PROGRESS_KEY = 'chattalk.sgmProgress';

export async function loadBank(s: Settings): Promise<BankTerm[]> {
  let terms = BUNDLED;
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) terms = JSON.parse(cached);
  } catch {}
  if (s.serverUrl) {
    try {
      const fresh = await fetchBank(s);
      if (Array.isArray(fresh) && fresh.length) {
        terms = fresh;
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
      }
    } catch {}
  }
  return terms;
}

export type BankProgress = Record<string, { right: number; wrong: number; lastTested: number }>;

export async function loadBankProgress(): Promise<BankProgress> {
  try {
    return JSON.parse((await AsyncStorage.getItem(PROGRESS_KEY)) || '{}');
  } catch {
    return {};
  }
}

export async function saveBankResult(word: string, ok: boolean) {
  const p = await loadBankProgress();
  const cur = p[word] || { right: 0, wrong: 0, lastTested: 0 };
  p[word] = { right: cur.right + (ok ? 1 : 0), wrong: cur.wrong + (ok ? 0 : 1), lastTested: Date.now() };
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(p)).catch(() => {});
}

/** A bank term as a test question word (scored apart from your own words). */
export const bankWord = (t: BankTerm) => ({
  id: 'sgm:' + t.word,
  word: t.word,
  lang: 'zh',
  pinyin: t.pinyin,
  root: '',
  part_of_speech: '',
  meaning: t.meaning,
  in_context: '',
  notes: '',
  example: null,
  sentence: '',
  sessionId: '',
  sessionTitle: 'SG Mandarin',
  createdAt: 0,
});

/** Plain letters, no tone marks (for searching and the A–Z letters). */
export const plain = (t: string) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

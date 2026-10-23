import AsyncStorage from '@react-native-async-storage/async-storage';

import { Word } from './types';

// Daily review: each right answer moves a word up the ladder, a wrong one sends it back to tomorrow.
export const LADDER = [1, 3, 7, 14, 30, 90]; // days until the next review, after 1, 2, 3... right answers in a row
export const REVIEW_MAX = 20; // per session, so a big backlog comes in manageable pieces

export const dayNum = (t = Date.now()) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);
export const srsOf = (w: Word) => w.srs || { step: 0, due: dayNum(w.createdAt || Date.now()) + 1 }; // new words: the day after saving
export const dueIn = (w: Word) => srsOf(w).due - dayNum();
export const dueWords = (words: Word[]) =>
  words.filter((w) => dueIn(w) <= 0).sort((a, b) => srsOf(a).due - srsOf(b).due || srsOf(a).step - srsOf(b).step);
export const whenText = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);
export const nextReview = (words: Word[]) => whenText(Math.min(...words.map(dueIn)));

/** Where a word goes after a review answer. Right after needing the choices: again tomorrow, no step up. */
export function afterReview(w: Word, ok: boolean, usedChoices: boolean): Word['srs'] {
  const st = srsOf(w);
  const today = dayNum();
  if (!ok) return { step: 0, due: today + 1 };
  if (usedChoices) return { step: st.step, due: today + 1 };
  const step = Math.min(LADDER.length, st.step + 1);
  return { step, due: today + LADDER[step - 1] };
}

// The days you reviewed on, for the streak
const KEY = 'tingyi.reviewDays';
let days = new Set<number>();
export async function loadReviewDays() {
  try {
    days = new Set(JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'));
  } catch {}
}
export function markReviewDay() {
  days.add(dayNum());
  AsyncStorage.setItem(KEY, JSON.stringify([...days].sort((a, b) => a - b).slice(-400))).catch(() => {});
}
export function reviewStreak() {
  let d = dayNum();
  if (!days.has(d)) d--;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

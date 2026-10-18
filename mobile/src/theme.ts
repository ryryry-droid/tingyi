import { useColorScheme } from 'react-native';

const light = {
  paper: '#EDF1EE', // pale celadon
  card: '#F8FAF8',
  ink: '#16201B',
  muted: '#5D6B64',
  faint: '#8D9A93',
  line: '#D3DCD6',
  accent: '#2D6A5C',
  accentInk: '#FFFFFF',
  accentSoft: '#DCE9E3',
  rec: '#B4442C',
  warn: '#8A5A12',
  warnSoft: '#F3E8D3',
  ok: '#2F6B4F',
  tones: ['#8D9A93', '#B4442C', '#3F7D3A', '#3460A8', '#7B4597'], // neutral, 1st..4th tone
};
const dark: typeof light = {
  paper: '#0F1513',
  card: '#161E1B',
  ink: '#E2EAE6',
  muted: '#9AAAA2',
  faint: '#6E7D76',
  line: '#27332E',
  accent: '#7DBBA8',
  accentInk: '#0C1714',
  accentSoft: '#1D2E28',
  rec: '#F08A70',
  warn: '#E2B566',
  warnSoft: '#2C2516',
  ok: '#8CCB7E',
  tones: ['#6E7D76', '#F08A70', '#8CCB7E', '#8FB2F0', '#C79BE0'],
};
export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const SERIF_HAN = 'serif';

export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const TONE_MARKS = [/[āēīōūǖĀĒĪŌŪǕ]/, /[áéíóúǘÁÉÍÓÚǗ]/, /[ǎěǐǒǔǚǍĚǏǑǓǙ]/, /[àèìòùǜÀÈÌÒÙǛ]/];
/** Splits tone-marked pinyin into syllables with their tone (0 = neutral, or not a syllable). */
export function pinyinTones(py: string): { syl: string; tone: number }[] {
  return String(py || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((syl) => ({ syl, tone: TONE_MARKS.findIndex((re) => re.test(syl)) + 1 }));
}

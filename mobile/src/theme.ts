import { createContext, useContext } from 'react';

// ChatTalk colours, sampled from the logo: charcoal head, blue body and "A" bubble,
// yellow wing and "文" bubble, pink beak. Same values as the web app.
const dark = {
  dark: true,
  bg: '#1C1D25',
  surface: '#272833',
  surface2: '#30323F',
  line: '#3A3C4B',
  ink: '#F4F3F6',
  muted: '#A4A7B9',
  faint: '#6F7285',
  accent: '#4F95E8',
  accentInk: '#FFFFFF',
  accentSoft: '#22324A',
  rec: '#E75474',
  warn: '#FBC73B',
  warnSoft: '#3A3322',
  sky: '#4F95E8',
  skyInk: '#FFFFFF',
  yellow: '#FBC73B',
  yellowInk: '#3A2C05',
  yellowSoft: '#3A3322',
  yellowText: '#FBC73B',
  ok: '#5BC48A',
  okSoft: '#24392F',
  badSoft: '#3E2530',
  tones: ['#6F7285', '#F07A92', '#FBC73B', '#6FB0F5', '#B7A3F5'], // neutral, 1st..4th tone
};
const light: typeof dark = {
  dark: false,
  bg: '#F7F5F6',
  surface: '#FFFFFF',
  surface2: '#EFEDF2',
  line: '#E2DFE6',
  ink: '#2B2C37',
  muted: '#666879',
  faint: '#9A9CAB',
  accent: '#3078C4',
  accentInk: '#FFFFFF',
  accentSoft: '#E3EEFB',
  rec: '#E75474',
  warn: '#8A5A00',
  warnSoft: '#FFF3D1',
  sky: '#4F95E8',
  skyInk: '#FFFFFF',
  yellow: '#FBC73B',
  yellowInk: '#3A2C05',
  yellowSoft: '#FFF5D9',
  yellowText: '#9A6B00',
  ok: '#3FAA6F',
  okSoft: '#E2F4EA',
  badSoft: '#FBE4EA',
  tones: ['#9A9CAB', '#D2405F', '#B57F00', '#2C6FB8', '#7B56C9'],
};
export type Colors = typeof dark;
export const PALETTES = { dark, light };

export const ThemeContext = createContext<Colors>(dark);
export function useColors(): Colors {
  return useContext(ThemeContext);
}

export const HAN_FONT = 'serif';

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

// Accent stripping without relying on String.normalize (pinyin tones, Vietnamese, Malay/Indonesian loanwords)
const ACCENTS: Record<string, string> = {
  a: 'àáâãäåāăąǎạảấầẩẫậắằẳẵặ',
  e: 'èéêëēĕėęěẹẻẽếềểễệ',
  i: 'ìíîïĩīĭįǐỉịı',
  o: 'òóôõöōŏőǒơọỏốồổỗộớờởỡợø',
  u: 'ùúûüũūŭůűųǔưụủứừửữựǖǘǚǜ',
  y: 'ýÿŷỳỵỷỹ',
  n: 'ñńňǹ',
  c: 'çćč',
  d: 'đ',
  s: 'śšş',
  z: 'žźż',
  g: 'ğ',
};
const DEACCENT: Record<string, string> = {};
for (const [base, chars] of Object.entries(ACCENTS)) for (const ch of chars) DEACCENT[ch] = base;

export function deaccent(text: string) {
  let out = '';
  for (const ch of String(text || '').toLowerCase()) out += DEACCENT[ch] ?? ch;
  return out.replace(/[̀-ͯ]/g, '');
}
/** For comparing typed answers: no accents, tones, spaces or punctuation. */
export const toneless = (t: string) => deaccent(t).replace(/[^a-z0-9㐀-鿿]/g, '');

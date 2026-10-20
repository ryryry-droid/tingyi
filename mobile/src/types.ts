export type Source = string; // a code from CATALOG
export type Target = string; // any CATALOG code except Cantonese
export type WordLang = string;

// Every language the app offers: [code, short name, label in lists, example word, voice for read-aloud]
export const CATALOG: [string, string, string, string, string][] = [
  ['zh', 'Mandarin', 'Mandarin 普通话', '周末', 'zh-CN'],
  ['yue', 'Cantonese', 'Cantonese 粤语', '', 'zh-HK'],
  ['en', 'English', 'English', '', 'en-US'],
  ['id', 'Indonesian', 'Indonesian', 'belajar', 'id-ID'],
  ['ms', 'Malay', 'Malay', 'makan', 'ms-MY'],
  ['vi', 'Vietnamese', 'Vietnamese Tiếng Việt', 'cảm ơn', 'vi-VN'],
  ['th', 'Thai', 'Thai ภาษาไทย', 'ขอบคุณ', 'th-TH'],
  ['tl', 'Filipino', 'Filipino', 'salamat', 'fil-PH'],
  ['km', 'Khmer', 'Khmer ខ្មែរ', 'អរគុណ', 'km-KH'],
  ['ja', 'Japanese', 'Japanese 日本語', '週末', 'ja-JP'],
  ['ko', 'Korean', 'Korean 한국어', '감사합니다', 'ko-KR'],
  ['hi', 'Hindi', 'Hindi हिन्दी', 'धन्यवाद', 'hi-IN'],
  ['ta', 'Tamil', 'Tamil தமிழ்', 'நன்றி', 'ta-IN'],
  ['es', 'Spanish', 'Spanish Español', 'gracias', 'es-ES'],
  ['fr', 'French', 'French Français', 'merci', 'fr-FR'],
  ['de', 'German', 'German Deutsch', 'danke', 'de-DE'],
  ['it', 'Italian', 'Italian Italiano', 'grazie', 'it-IT'],
  ['pt', 'Portuguese', 'Portuguese Português', 'obrigado', 'pt-BR'],
  ['ru', 'Russian', 'Russian Русский', 'спасибо', 'ru-RU'],
  ['ar', 'Arabic', 'Arabic العربية', 'شكرا', 'ar-SA'],
  ['tr', 'Turkish', 'Turkish Türkçe', 'teşekkürler', 'tr-TR'],
];
export const LANGS: Record<string, string> = Object.fromEntries(CATALOG.map(([c, n]) => [c, n]));
export const LANG_LABEL: Record<string, string> = Object.fromEntries(CATALOG.map(([c, , l]) => [c, l]));
export const WORD_EXAMPLE: Record<string, string> = Object.fromEntries(CATALOG.map(([c, , , e]) => [c, e]));
export const SPEECH_LANG: Record<string, string> = Object.fromEntries(CATALOG.map(([c, , , , v]) => [c, v]));
export const DEFAULT_LANGS = ['zh', 'yue', 'id', 'ms', 'vi', 'en'];
export const LOOKUP_LANGS = CATALOG.map(([c]) => c).filter((c) => c !== 'en');

const ordered = (codes: string[]) => CATALOG.map(([c]) => c).filter((c) => codes.includes(c));
export const sourceOptions = (langs: string[]) => ordered(langs).map((c) => ({ value: c, label: LANG_LABEL[c] }));
export const targetLangs = (langs: string[]) => ordered(langs).filter((c) => c !== 'yue');
export const targetOptions = (langs: string[]) =>
  targetLangs(langs).map((c) => ({ value: c, label: c === 'zh' ? 'Mandarin 中文' : LANG_LABEL[c] }));
export const distinctLangs = (langs: string[]) => new Set(langs.map((c) => (c === 'yue' ? 'zh' : c))).size;

export const isChinese = (code?: string) => code === 'zh' || code === 'yue';
export const baseOf = (code: string): string => (code === 'yue' ? 'zh' : code);
export const hasHan = (text?: string) => /[㐀-鿿]/.test(text || '');

export type Segment = {
  id: number;
  start: number; // seconds into the recording
  end: number;
  text: string; // what was said
  pinyin?: string | null;
  translation: string;
  translation_pinyin?: string | null;
  lang?: string; // live conversation: the language of this line
  target?: string;
};

export type SessionStatus = 'processing' | 'done' | 'error';

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  duration: number; // seconds
  audioUri: string;
  source: Source;
  target: Target;
  script: 'simplified' | 'traditional';
  status: SessionStatus;
  error?: string;
  segments: Segment[];
  mode?: 'subtitles' | 'conversation'; // live sessions
  untranslated?: string; // translating failed but the transcript was kept: why, so lines can be translated later
};

export type Settings = {
  serverUrl: string;
  apiToken: string;
  source: Source;
  target: Target;
  script: 'simplified' | 'traditional';
  style: 'natural' | 'literal';
  pinyin: boolean;
  glossary: string; // one term per line, e.g. "王小明 = Wang Xiaoming"
  theme: 'dark' | 'light';
  vibrate: boolean;
  cry: boolean; // old on/off for the cry (replaced by volume)
  volume: number; // Chatot slider: cry and wrong-answer sound, 0 (off) / 10 / 30 / 100
  langs: string[]; // the languages shown in the pickers
  mainLang: string; // the language you're mainly learning: Words opens on it, Add word starts in it ('' = first)
};

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: '',
  apiToken: '',
  source: 'zh',
  target: 'en',
  script: 'simplified',
  style: 'natural',
  pinyin: true,
  glossary: '',
  theme: 'dark',
  vibrate: true,
  cry: true,
  volume: 10,
  langs: DEFAULT_LANGS,
  mainLang: '',
};

export type Example = { text: string; pinyin?: string | null; translation: string };

export type LookupEntry = {
  word: string;
  lang: string;
  pinyin?: string | null;
  root: string;
  part_of_speech: string;
  meaning: string;
  in_context: string;
  notes: string;
  example?: Example | null;
  register?: string; // "colloquial" or "standard"
  standard?: string; // standard form of a colloquial word (gak -> tidak)
  exists?: boolean; // false when it isn't a real word (often a mishearing)
  suggestions?: string[]; // real words that were probably meant
  senses?: { sense: string; word: string; pinyin?: string | null }[]; // an English word's different meanings (Add word in English)
};

export type Word = {
  id: string;
  word: string;
  lang: WordLang;
  pinyin: string;
  root: string;
  part_of_speech: string;
  meaning: string;
  in_context: string;
  notes: string;
  example: Example | null;
  register?: string; // "colloquial" or "standard" (missing on words saved before this was recorded)
  standard?: string;
  sentence: string;
  sessionId: string;
  sessionTitle: string;
  createdAt: number;
  level?: number; // 0..3, how well you know it
  right?: number;
  wrong?: number;
  lastTested?: number;
};

export type TestKind = 'meaning' | 'word' | 'gap' | 'type';
export type TestSetup = { group: string; count: number; kinds: TestKind[] };
export const DEFAULT_TEST_SETUP: TestSetup = { group: 'all', count: 10, kinds: ['meaning', 'word', 'gap'] };

export const wordLangOf = (lang: string): WordLang => (isChinese(lang) ? 'zh' : lang);

/** Your languages you can learn (not English), Cantonese counted as Chinese. */
export const learnLangs = (langs: string[]) => [...new Set(langs.filter((c) => c !== 'en').map(wordLangOf))];
/** The main learning language from Settings, or your first one. */
export function learningLang(s: { langs: string[]; mainLang?: string }): string {
  const mine = learnLangs(s.langs);
  return s.mainLang && mine.includes(s.mainLang) ? s.mainLang : mine[0] || 'zh';
}

/** Languages you can save and test words in: your languages except English, plus any you have saved words in. */
export function wordLangs(langs: string[], words: { lang: string }[]): [string, string][] {
  const codes = new Set(langs.filter((c) => c !== 'en').map(wordLangOf));
  words.forEach((w) => codes.add(w.lang));
  return CATALOG.filter(([c]) => codes.has(c)).map(([c, n]) => [c, c === 'zh' ? 'Chinese' : n]);
}

/** Make the language pair valid for the chosen languages. */
export function fixPair(langs: string[], source: string, target: string): { source: string; target: string } {
  if (!langs.includes(source)) source = langs[0];
  const targets = targetLangs(langs);
  const ok = (t: string) => targets.includes(t) && t !== baseOf(source);
  if (!ok(target)) target = ['en', ...targets].find(ok) || targets[0];
  return { source, target };
}
// Saved words are kept in lowercase ("Makan" at the start of a sentence is saved as "makan"),
// except proper nouns: names of people, places, brands
const lower = (t?: string) => String(t || '').toLocaleLowerCase();
export const isProper = (pos?: string) => /proper|name|place/i.test(pos || '');
export const caseFor = (t: string | undefined, pos?: string) => (isProper(pos) ? String(t || '') : lower(t));
export const wordId = (lang: string, word: string) => `${wordLangOf(lang)}:${lower(word)}`;

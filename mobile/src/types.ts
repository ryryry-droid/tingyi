export type Source = 'zh' | 'yue' | 'id' | 'en';
export type Target = 'en' | 'zh' | 'id';

export const LANGS: Record<Source, string> = { zh: 'Mandarin', yue: 'Cantonese', id: 'Indonesian', en: 'English' };
export const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'zh', label: 'Mandarin 普通话' },
  { value: 'yue', label: 'Cantonese 粤语' },
  { value: 'id', label: 'Indonesian' },
  { value: 'en', label: 'English' },
];
export const TARGET_OPTIONS: { value: Target; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Mandarin 中文' },
  { value: 'id', label: 'Indonesian' },
];
export const isChinese = (code?: string) => code === 'zh' || code === 'yue';
export const baseOf = (code: Source): Target | 'yue' => (code === 'yue' ? 'zh' : code) as Target;

export type Segment = {
  id: number;
  start: number; // seconds into the recording
  end: number;
  text: string; // what was said
  pinyin?: string | null;
  translation: string;
  translation_pinyin?: string | null;
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
};

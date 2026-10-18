export type Segment = {
  id: number;
  start: number; // seconds into the recording
  end: number;
  zh: string;
  pinyin?: string | null;
  en: string;
};

export type SessionStatus = 'processing' | 'done' | 'error';

export type Session = {
  id: string;
  title: string;
  createdAt: number;
  duration: number; // seconds
  audioUri: string;
  status: SessionStatus;
  error?: string;
  segments: Segment[];
};

export type Settings = {
  serverUrl: string;
  apiToken: string;
  script: 'simplified' | 'traditional';
  dialect: 'mandarin' | 'cantonese';
  style: 'natural' | 'literal';
  pinyin: boolean;
  glossary: string; // one term per line, e.g. "王小明 = Wang Xiaoming"
};

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: 'http://192.168.1.10:8000',
  apiToken: '',
  script: 'simplified',
  dialect: 'mandarin',
  style: 'natural',
  pinyin: true,
  glossary: '',
};

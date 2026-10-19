import { File } from 'expo-file-system';

import { LookupEntry, Segment, Session, Settings } from './types';

function baseUrl(s: Settings) {
  let url = s.serverUrl.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  return url;
}

function headers(s: Settings): Record<string, string> {
  return s.apiToken ? { Authorization: `Bearer ${s.apiToken.trim()}` } : {};
}

export function options(s: Settings, source: string, target: string, script = s.script) {
  return {
    source,
    target,
    script,
    style: s.style,
    pinyin: s.pinyin,
    glossary: s.glossary
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function check(res: Response) {
  if (res.ok) return res.json();
  if (res.status === 401) throw new ApiError('Wrong or missing access code. Check it in Settings.', 401);
  let detail = `Server error ${res.status}`;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
  } catch {}
  throw new ApiError(detail, res.status);
}

function friendly(e: any): Error {
  const msg = String(e?.message ?? e);
  if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
    return new ApiError('Couldn’t reach the server. Check your internet connection and the server address in Settings.', -1);
  }
  return e instanceof Error ? e : new Error(msg);
}

function needServer(s: Settings) {
  if (!baseUrl(s)) throw new ApiError('Add your server address in Settings first.');
}

async function postJson<T>(s: Settings, path: string, body: unknown): Promise<T> {
  needServer(s);
  try {
    const res = await fetch(`${baseUrl(s)}${path}`, {
      method: 'POST',
      headers: { ...headers(s), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await check(res);
  } catch (e) {
    throw friendly(e);
  }
}

async function postFile<T>(s: Settings, path: string, fileUri: string, fields: Record<string, string>): Promise<T> {
  needServer(s);
  const audio = new File(fileUri);
  if (!audio.exists) throw new ApiError('The audio for this recording is no longer on your phone.');
  const form = new FormData();
  // Expo's fetch reads the file itself when given an expo-file-system File (a Blob);
  // the older React Native {uri, name, type} object isn't supported by it.
  form.append('file', audio as unknown as Blob);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  try {
    const res = await fetch(`${baseUrl(s)}${path}`, { method: 'POST', headers: headers(s), body: form });
    return await check(res);
  } catch (e) {
    throw friendly(e);
  }
}

export async function checkServer(s: Settings): Promise<string> {
  if (!baseUrl(s)) throw new Error('Enter the server address first.');
  try {
    const body = await check(await fetch(`${baseUrl(s)}/health`));
    return `Connected · ${body.transcriber ?? 'Whisper'} · ${body.translator}`;
  } catch (e) {
    throw friendly(e);
  }
}

/** Upload a recording; returns the translated lines and a summary title. */
export function translateRecording(s: Settings, session: Session): Promise<{ duration: number; title: string; segments: Segment[] }> {
  if (!baseUrl(s)) return Promise.reject(new Error('Add your server address in Settings, then tap Try again.'));
  return postFile(s, '/api/translate', session.audioUri, {
    options: JSON.stringify(options(s, session.source, session.target, session.script)),
  });
}

/** Re-translate one line after the user corrects what was said. */
export function retranslate(
  s: Settings,
  text: string,
  context: Segment[],
  source: string,
  target: string,
  script: Session['script'],
): Promise<{ text: string; pinyin?: string | null; translation: string; translation_pinyin?: string | null }> {
  return postJson(s, '/api/retranslate', { text, context, options: options(s, source, target, script) });
}

/** fromEnglish: "word" is English, find how to say it in lang. */
export function lookupWord(s: Settings, word: string, sentence: string, lang: string, fromEnglish = false): Promise<LookupEntry> {
  return postJson(s, '/api/lookup', { word, sentence, lang, script: s.script, from_english: fromEnglish });
}

/** Which of these words are colloquial (for words saved before this was recorded). */
export function checkRegister(
  s: Settings,
  lang: string,
  words: string[],
): Promise<{ results: { word: string; register: string; standard: string }[] }> {
  return postJson(s, '/api/register', { lang, words });
}

export type LiveSegment = { start: number; end: number; text: string; pinyin?: string | null; lang: string; target: string };

/** Transcribe a short audio chunk (live mode, or a spoken word). */
export function liveTranscribe(
  s: Settings,
  fileUri: string,
  opts: ReturnType<typeof options>,
  offset: number,
  detect: boolean,
): Promise<{ segments: LiveSegment[] }> {
  return postFile(s, '/api/live/transcribe', fileUri, {
    options: JSON.stringify(opts),
    offset: String(offset),
    detect: detect ? 'true' : 'false',
  });
}

export function liveTranslate(
  s: Settings,
  lines: { id: number; text: string }[],
  context: { text: string; translation: string }[],
  opts: ReturnType<typeof options>,
): Promise<{ translations: { id: number; translation: string; translation_pinyin?: string | null }[] }> {
  return postJson(s, '/api/live/translate', { lines, context, options: opts });
}

export async function makeTitle(s: Settings, lines: { text: string; translation: string }[], opts: ReturnType<typeof options>) {
  const r = await postJson<{ title: string }>(s, '/api/title', { lines, options: opts });
  return r.title;
}

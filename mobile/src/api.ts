import { File, Paths } from 'expo-file-system';

import { LookupEntry, Segment, Session, Settings, WordFamily } from './types';

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
export function translateRecording(
  s: Settings,
  session: Session,
): Promise<{ duration: number; title: string; segments: Segment[]; translation_error?: string }> {
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
export function lookupWord(s: Settings, word: string, sentence: string, lang: string, fromEnglish = false, sense = ''): Promise<LookupEntry> {
  return postJson(s, '/api/lookup', { word, sentence, lang, script: s.script, from_english: fromEnglish, sense });
}

/** An Indonesian / Malay word's family: its base word and the common forms built from it. */
export function wordFamily(s: Settings, word: string, lang: string, meaning: string): Promise<WordFamily> {
  return postJson(s, '/api/family', { word, lang, meaning });
}

/** Which of these words are colloquial (for words saved before this was recorded). */
export function checkRegister(
  s: Settings,
  lang: string,
  words: string[],
): Promise<{ results: { word: string; register: string; standard: string }[] }> {
  return postJson(s, '/api/register', { lang, words });
}

/**
 * Redo one line: the server listens to that part of the recording again and translates it again.
 * Live sessions are long WAV files, so just the part around the line is cut out here and sent.
 */
export async function redoLine(
  s: Settings,
  session: Session,
  seg: Segment,
  context: Segment[],
  after: Segment[],
): Promise<{ text: string; pinyin?: string | null; translation: string; translation_pinyin?: string | null }> {
  if (!session.audioUri) throw new Error('The audio for this recording isn’t on this phone.');
  let uri = session.audioUri;
  let start = seg.start;
  let end = seg.end;
  let clip: File | null = null;
  if (uri.toLowerCase().endsWith('.wav')) {
    try {
      const cut = cutWav(uri, start, end);
      if (cut) ({ file: clip, start, end } = cut);
      if (clip) uri = clip.uri;
    } catch {}
  }
  try {
    return await postFile(s, '/api/redo', uri, {
      options: JSON.stringify(options(s, seg.lang || session.source, seg.target || session.target, session.script)),
      start: String(start),
      end: String(end),
      context: JSON.stringify(context.map((c) => ({ text: c.text, translation: c.translation }))),
      // the line as it is now, and what comes after: the server keeps what was right and only fixes mistakes
      after: JSON.stringify(after.map((c) => c.text)),
      original: seg.text,
      original_translation: seg.translation || '',
    });
  } finally {
    try {
      clip?.delete();
    } catch {}
  }
}

function cutWav(uri: string, start: number, end: number): { file: File; start: number; end: number } | null {
  const bytes = new File(uri).bytesSync();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  let rate = 0;
  let block = 0;
  let fmt: Uint8Array | null = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      rate = v.getUint32(o + 12, true);
      block = v.getUint16(o + 20, true);
      fmt = bytes.slice(o + 8, o + 8 + Math.min(size, 16));
    } else if (id === 'data' && rate && block && fmt) {
      const dataStart = o + 8;
      const dataLen = Math.min(size || bytes.length - dataStart, bytes.length - dataStart);
      const lo = Math.max(0, start - 1);
      const hi = end + 1;
      const a = dataStart + Math.min(dataLen, Math.floor(lo * rate) * block);
      const b = dataStart + Math.min(dataLen, Math.ceil(hi * rate) * block);
      const pcm = bytes.slice(a, b);
      const out = new Uint8Array(44 + pcm.length);
      const w = new DataView(out.buffer);
      const put = (p: number, t: string) => [...t].forEach((ch, i) => (out[p + i] = ch.charCodeAt(0)));
      put(0, 'RIFF');
      w.setUint32(4, 36 + pcm.length, true);
      put(8, 'WAVE');
      put(12, 'fmt ');
      w.setUint32(16, 16, true);
      out.set(fmt, 20);
      put(36, 'data');
      w.setUint32(40, pcm.length, true);
      out.set(pcm, 44);
      const file = new File(Paths.cache, `redo-${Date.now()}.wav`);
      file.create({ overwrite: true });
      file.write(out);
      return { file, start: start - lo, end: end - lo };
    }
    o += 8 + size + (size % 2);
  }
  return null;
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

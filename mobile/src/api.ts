import { Segment, Session, Settings, Source, Target } from './types';

function baseUrl(s: Settings) {
  let url = s.serverUrl.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  return url;
}

function headers(s: Settings): Record<string, string> {
  return s.apiToken ? { Authorization: `Bearer ${s.apiToken.trim()}` } : {};
}

function options(s: Settings, source: Source, target: Target) {
  return {
    source,
    target,
    script: s.script,
    style: s.style,
    pinyin: s.pinyin,
    glossary: s.glossary
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

async function check(res: Response) {
  if (res.ok) return res.json();
  if (res.status === 401) throw new Error('Wrong or missing access code. Check it in Settings.');
  let detail = `Server error ${res.status}`;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
  } catch {}
  throw new Error(detail);
}

function friendly(e: any): Error {
  const msg = String(e?.message ?? e);
  if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
    return new Error('Couldn’t reach the server. Check your internet connection and the server address in Settings.');
  }
  return e instanceof Error ? e : new Error(msg);
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

const MIME: Record<string, string> = { m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac', '3gp': 'audio/3gpp', amr: 'audio/amr', flac: 'audio/flac' };

/** Upload a recording; returns the translated lines and a summary title. */
export async function translateRecording(
  s: Settings,
  session: Session,
): Promise<{ duration: number; title: string; segments: Segment[] }> {
  if (!baseUrl(s)) throw new Error('Add your server address in Settings, then tap Try again.');
  const ext = (session.audioUri.split('?')[0].split('.').pop() || 'm4a').toLowerCase();
  const form = new FormData();
  // React Native's FormData accepts {uri, name, type} for local files.
  form.append('file', { uri: session.audioUri, name: `recording.${ext}`, type: MIME[ext] || 'audio/mp4' } as any);
  form.append('options', JSON.stringify(options(s, session.source, session.target)));
  try {
    const res = await fetch(`${baseUrl(s)}/api/translate`, { method: 'POST', headers: headers(s), body: form });
    return await check(res);
  } catch (e) {
    throw friendly(e);
  }
}

/** Re-translate one line after the user corrects what was said. */
export async function retranslate(
  s: Settings,
  session: Session,
  text: string,
  context: Segment[],
): Promise<{ text: string; pinyin?: string | null; translation: string; translation_pinyin?: string | null }> {
  try {
    const res = await fetch(`${baseUrl(s)}/api/retranslate`, {
      method: 'POST',
      headers: { ...headers(s), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context, options: options(s, session.source, session.target) }),
    });
    return await check(res);
  } catch (e) {
    throw friendly(e);
  }
}

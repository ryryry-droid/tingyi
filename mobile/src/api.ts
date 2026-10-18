import { Segment, Settings } from './types';

function baseUrl(s: Settings) {
  return s.serverUrl.trim().replace(/\/+$/, '');
}

function headers(s: Settings): Record<string, string> {
  return s.apiToken ? { Authorization: `Bearer ${s.apiToken}` } : {};
}

function options(s: Settings) {
  return {
    script: s.script,
    dialect: s.dialect,
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
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
  } catch {}
  throw new Error(detail);
}

export async function checkServer(s: Settings): Promise<string> {
  const body = await check(await fetch(`${baseUrl(s)}/health`));
  return `Connected · speech: ${body.asr} · translator: ${body.translator}`;
}

/** Upload a finished recording; returns the translated segments. */
export async function translateRecording(
  s: Settings,
  audioUri: string,
): Promise<{ duration: number; segments: Segment[] }> {
  const form = new FormData();
  // React Native's FormData accepts {uri, name, type} for local files.
  form.append('file', { uri: audioUri, name: 'recording.m4a', type: 'audio/m4a' } as any);
  form.append('options', JSON.stringify(options(s)));
  const res = await fetch(`${baseUrl(s)}/api/translate`, {
    method: 'POST',
    headers: headers(s),
    body: form,
  });
  return check(res);
}

/** Re-translate one line after the user corrects the Chinese. */
export async function retranslate(
  s: Settings,
  zh: string,
  context: Segment[],
): Promise<{ zh: string; pinyin?: string | null; en: string }> {
  const res = await fetch(`${baseUrl(s)}/api/retranslate`, {
    method: 'POST',
    headers: { ...headers(s), 'Content-Type': 'application/json' },
    body: JSON.stringify({ zh, context, options: options(s) }),
  });
  return check(res);
}

import * as Speech from 'expo-speech';

import { SPEECH_LANG, Word } from './types';

// Android's speech module only accepts a bare language code ("zh", not "zh-CN"); anything else silently
// falls back to the phone's default voice (often English). So we pass the bare code, plus a matching
// voice when the phone has one (that's how Mandarin vs Taiwanese/Cantonese voices are chosen).
let voices: Speech.Voice[] | null = null;
async function loadVoices() {
  if (voices) return voices;
  try {
    voices = await Speech.getAvailableVoicesAsync();
  } catch {
    voices = [];
  }
  return voices;
}

const norm = (tag: string) => tag.replace('_', '-').toLowerCase();

function pickVoice(list: Speech.Voice[], tag: string): Speech.Voice | undefined {
  const want = norm(tag);
  const base = want.split('-')[0];
  const usable = list.filter((v) => !/network|notinstalled/i.test(v.identifier || ''));
  const pool = usable.length ? usable : list;
  return (
    pool.find((v) => norm(v.language) === want && v.quality === Speech.VoiceQuality.Enhanced) ||
    pool.find((v) => norm(v.language) === want) ||
    pool.find((v) => norm(v.language).split('-')[0] === base)
  );
}

/** Read a saved word aloud with the phone's voice for its language. */
export async function speakWord(w: Pick<Word, 'word' | 'lang'>, script: 'simplified' | 'traditional') {
  try {
    Speech.stop();
    const tag = w.lang === 'zh' ? (script === 'traditional' ? 'zh-TW' : 'zh-CN') : SPEECH_LANG[w.lang] || w.lang;
    const language = tag.split('-')[0];
    const voice = pickVoice(await loadVoices(), tag);
    Speech.speak(w.word, { language, voice: voice?.identifier, rate: 0.85 });
  } catch {}
}

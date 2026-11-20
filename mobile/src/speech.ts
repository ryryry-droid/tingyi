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

/** Read a sentence aloud; resolves when it has finished (or was stopped).
 *  warm: first say the opening of it silently (volume 0), so the phone's speech engine is already running
 *  when the real sentence starts. Otherwise the engine sometimes starts late and the first sound is cut off. */
export async function speakText(text: string, lang: string, script: 'simplified' | 'traditional', rate = 0.9, warm = false): Promise<void> {
  const tag = lang === 'zh' ? (script === 'traditional' ? 'zh-TW' : 'zh-CN') : SPEECH_LANG[lang] || lang;
  const voice = pickVoice(await loadVoices(), tag);
  // Google's speech engine (voice names like "cmn-cn-x-ccc-local") understands SSML, so the sentence can start
  // with a short silence inside the same utterance: if the engine starts late, it cuts into the silence instead
  // of the first sound. Other engines would read the tags aloud, so they get a silent warm-up utterance instead.
  const google = !!voice && /-x-/.test(voice.identifier || '');
  let say = text;
  if (warm && google) {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    say = `<speak><break time="400ms"/>${esc}</speak>`;
  } else if (warm) {
    try {
      const lead = lang === 'zh' || lang === 'yue' || lang === 'ja' ? text.slice(0, 2) : text.split(/\s+/)[0] || text;
      Speech.speak(lead, { language: tag.split('-')[0], voice: voice?.identifier, rate: 1.5, volume: 0 }); // queued straight before the sentence
    } catch {}
  }
  return new Promise((resolve) => {
    try {
      Speech.speak(say, {
        language: tag.split('-')[0],
        voice: voice?.identifier,
        rate,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

export function stopSpeaking() {
  try {
    Speech.stop();
  } catch {}
}

import * as Speech from 'expo-speech';

import { SPEECH_LANG, Word } from './types';

/** Read a saved word aloud with the phone's voice for its language. */
export function speakWord(w: Pick<Word, 'word' | 'lang'>, script: 'simplified' | 'traditional') {
  try {
    Speech.stop();
    const language = w.lang === 'zh' ? (script === 'traditional' ? 'zh-TW' : 'zh-CN') : SPEECH_LANG[w.lang] || w.lang;
    Speech.speak(w.word, { language, rate: 0.85 });
  } catch {}
}

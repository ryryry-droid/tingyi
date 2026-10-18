import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { DEFAULT_LANGS, DEFAULT_SETTINGS, DEFAULT_TEST_SETUP, distinctLangs, fixPair, LANGS, Session, Settings, TestSetup, Word } from './types';

const SESSIONS_KEY = 'tingyi.sessions.v2';
const SETTINGS_KEY = 'tingyi.settings.v2';
const WORDS_KEY = 'chattalk.words.v1';
const TEST_KEY = 'chattalk.testSetup.v1';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function loadSessions(): Promise<Session[]> {
  const sessions = await readJson<Session[]>(SESSIONS_KEY, []);
  // A session left "processing" means the app was closed mid-upload.
  return sessions.map((s) =>
    s.status === 'processing' ? { ...s, status: 'error', error: 'Interrupted before it finished. Tap Try again.' } : s,
  );
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function deleteAudio(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // already gone
  }
}

export async function loadSettings(): Promise<Settings> {
  const s = { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS_KEY, {})) };
  if (s.theme !== 'light') s.theme = 'dark'; // dark is the default
  s.langs = (Array.isArray(s.langs) ? s.langs : DEFAULT_LANGS).filter((c) => LANGS[c]);
  if (distinctLangs(s.langs) < 2) s.langs = DEFAULT_LANGS.slice();
  return { ...s, ...fixPair(s.langs, s.source, s.target) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadWords(): Promise<Word[]> {
  const words = await readJson<Word[]>(WORDS_KEY, []);
  return words.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveWords(words: Word[]): Promise<void> {
  await AsyncStorage.setItem(WORDS_KEY, JSON.stringify(words));
}

export async function loadTestSetup(): Promise<TestSetup> {
  return { ...DEFAULT_TEST_SETUP, ...(await readJson<Partial<TestSetup>>(TEST_KEY, {})) };
}

export function saveTestSetup(setup: TestSetup) {
  AsyncStorage.setItem(TEST_KEY, JSON.stringify(setup)).catch(() => {});
}

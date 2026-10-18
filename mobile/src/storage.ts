import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { DEFAULT_SETTINGS, Session, Settings } from './types';

const SESSIONS_KEY = 'tingyi.sessions.v2';
const SETTINGS_KEY = 'tingyi.settings.v2';

export async function loadSessions(): Promise<Session[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  const sessions: Session[] = raw ? JSON.parse(raw) : [];
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
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

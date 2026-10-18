import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { translateRecording } from './src/api';
import HomeScreen from './src/screens/HomeScreen';
import SessionScreen from './src/screens/SessionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { deleteAudio, loadSessions, loadSettings, saveSessions, saveSettings } from './src/storage';
import { formatDate, useColors } from './src/theme';
import { DEFAULT_SETTINGS, Segment, Session, Settings } from './src/types';

type Route = { name: 'home' } | { name: 'session'; id: string } | { name: 'settings' };

export default function App() {
  const c = useColors();
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    Promise.all([loadSessions(), loadSettings()]).then(([sess, sett]) => {
      setSessions(sess);
      setSettings(sett);
      setReady(true);
    });
  }, []);

  // Persist whenever sessions change
  useEffect(() => {
    if (ready) saveSessions(sessions);
  }, [sessions, ready]);

  // Android back button goes back a screen instead of closing the app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'home') return false;
      setRoute({ name: 'home' });
      return true;
    });
    return () => sub.remove();
  }, [route.name]);

  function updateSession(id: string, change: (s: Session) => Session) {
    setSessions((prev) => prev.map((s) => (s.id === id ? change(s) : s)));
  }

  async function process(session: Session) {
    updateSession(session.id, (s) => ({ ...s, status: 'processing', error: undefined }));
    try {
      const result = await translateRecording(settingsRef.current, session);
      const first = result.segments[0]?.text;
      updateSession(session.id, (s) => ({
        ...s,
        status: 'done',
        segments: result.segments,
        duration: result.duration || s.duration,
        title: result.title || (first ? (first.length > 30 ? first.slice(0, 30) + '…' : first) : s.title),
      }));
    } catch (e: any) {
      updateSession(session.id, (s) => ({ ...s, status: 'error', error: String(e?.message ?? e) }));
    }
  }

  function onRecorded(audioUri: string, duration: number, fileName?: string) {
    const now = Date.now();
    const s = settingsRef.current;
    const session: Session = {
      id: String(now),
      title: fileName || `Recording ${formatDate(now)}`,
      createdAt: now,
      duration,
      audioUri,
      source: s.source,
      target: s.target,
      script: s.script,
      status: 'processing',
      segments: [],
    };
    setSessions((prev) => [session, ...prev]);
    setRoute({ name: 'session', id: session.id });
    process(session);
  }

  function onDelete(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (s) deleteAudio(s.audioUri);
    setSessions((prev) => prev.filter((x) => x.id !== id));
    setRoute({ name: 'home' });
  }

  function onUpdateSegment(sessionId: string, segmentId: number, changes: Partial<Segment>) {
    updateSession(sessionId, (s) => ({
      ...s,
      segments: s.segments.map((seg) => (seg.id === segmentId ? { ...seg, ...changes } : seg)),
    }));
  }

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  const current = route.name === 'session' ? sessions.find((s) => s.id === route.id) : undefined;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: c.paper }]} edges={['top', 'left', 'right']}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {!ready ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.accent} />
          </View>
        ) : route.name === 'settings' ? (
          <SettingsScreen
            settings={settings}
            onBack={() => setRoute({ name: 'home' })}
            onSave={(s) => {
              updateSettings(s);
              setRoute({ name: 'home' });
            }}
          />
        ) : current ? (
          <SessionScreen
            key={current.id}
            session={current}
            settings={settings}
            onBack={() => setRoute({ name: 'home' })}
            onRetry={() => process(current)}
            onDelete={() => onDelete(current.id)}
            onRename={(title) => updateSession(current.id, (s) => ({ ...s, title }))}
            onUpdateSegment={(segId, changes) => onUpdateSegment(current.id, segId, changes)}
          />
        ) : (
          <HomeScreen
            sessions={sessions}
            settings={settings}
            onLanguages={(source, target) => updateSettings({ ...settingsRef.current, source, target })}
            onRecorded={onRecorded}
            onOpen={(id) => setRoute({ name: 'session', id })}
            onSettings={() => setRoute({ name: 'settings' })}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

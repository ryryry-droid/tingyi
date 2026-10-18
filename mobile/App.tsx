import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { translateRecording } from './src/api';
import HomeScreen from './src/screens/HomeScreen';
import SessionScreen from './src/screens/SessionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { deleteAudio, loadSessions, loadSettings, saveSessions, saveSettings } from './src/storage';
import { colors, formatDate } from './src/theme';
import { DEFAULT_SETTINGS, Segment, Session, Settings } from './src/types';

type Route = { name: 'home' } | { name: 'session'; id: string } | { name: 'settings' };

export default function App() {
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

  function updateSession(id: string, change: (s: Session) => Session) {
    setSessions((prev) => prev.map((s) => (s.id === id ? change(s) : s)));
  }

  async function process(id: string, audioUri: string) {
    updateSession(id, (s) => ({ ...s, status: 'processing', error: undefined }));
    try {
      const result = await translateRecording(settingsRef.current, audioUri);
      const first = result.segments[0]?.zh;
      updateSession(id, (s) => ({
        ...s,
        status: 'done',
        segments: result.segments,
        duration: result.duration || s.duration,
        title: first ? (first.length > 22 ? first.slice(0, 22) + '…' : first) : s.title,
      }));
    } catch (e: any) {
      const message = String(e?.message ?? e);
      updateSession(id, (s) => ({
        ...s,
        status: 'error',
        error: message.includes('Network request failed')
          ? 'Could not reach the server. Check the address in Settings and that your phone is on the same network.'
          : message,
      }));
    }
  }

  function onRecorded(audioUri: string, duration: number) {
    const now = Date.now();
    const session: Session = {
      id: String(now),
      title: `Recording · ${formatDate(now)}`,
      createdAt: now,
      duration,
      audioUri,
      status: 'processing',
      segments: [],
    };
    setSessions((prev) => [session, ...prev]);
    setRoute({ name: 'session', id: session.id });
    process(session.id, audioUri);
  }

  function onDelete(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (s) deleteAudio(s.audioUri);
    setSessions((prev) => prev.filter((x) => x.id !== id));
  }

  function onUpdateSegment(sessionId: string, segmentId: number, changes: Partial<Segment>) {
    updateSession(sessionId, (s) => ({
      ...s,
      segments: s.segments.map((seg) => (seg.id === segmentId ? { ...seg, ...changes } : seg)),
    }));
  }

  const current = route.name === 'session' ? sessions.find((s) => s.id === route.id) : undefined;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        {!ready ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.seal} />
          </View>
        ) : route.name === 'settings' ? (
          <SettingsScreen
            settings={settings}
            onBack={() => setRoute({ name: 'home' })}
            onSave={(s) => {
              setSettings(s);
              saveSettings(s);
              setRoute({ name: 'home' });
            }}
          />
        ) : current ? (
          <SessionScreen
            key={current.id}
            session={current}
            settings={settings}
            onBack={() => setRoute({ name: 'home' })}
            onRetry={() => process(current.id, current.audioUri)}
            onUpdateSegment={(segId, changes) => onUpdateSegment(current.id, segId, changes)}
          />
        ) : (
          <HomeScreen
            sessions={sessions}
            onRecorded={onRecorded}
            onOpen={(id) => setRoute({ name: 'session', id })}
            onDelete={onDelete}
            onSettings={() => setRoute({ name: 'settings' })}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

import {
  AudioQuality,
  IOSOutputFormat,
  RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, formatDate, formatTime } from '../theme';
import { Session } from '../types';

// 16 kHz mono AAC is what speech models want, and keeps files small:
// ~15 MB per hour, under the 25 MB upload limit for recordings up to ~90 min.
const SPEECH_PRESET: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  directory: 'document', // keep recordings so lines can be replayed later
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

const MAX_SECONDS = 90 * 60;

type Props = {
  sessions: Session[];
  onRecorded: (audioUri: string, duration: number) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
};

export default function HomeScreen({ sessions, onRecorded, onOpen, onDelete, onSettings }: Props) {
  const recorder = useAudioRecorder(SPEECH_PRESET);
  const state = useAudioRecorderState(recorder, 200);
  const [busy, setBusy] = useState(false);
  const stopping = useRef(false);

  const seconds = state.durationMillis / 1000;
  // metering is in dBFS (about -60 quiet .. 0 loud); map to 0..1 for the level bar
  const level = state.isRecording && state.metering != null ? Math.min(1, Math.max(0, (state.metering + 60) / 60)) : 0;

  async function start() {
    setBusy(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access in Settings to record.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      Alert.alert('Could not start recording', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (stopping.current) return;
    stopping.current = true;
    setBusy(true);
    try {
      const duration = recorder.currentTime || seconds;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (recorder.uri) {
        if (duration < 1) Alert.alert('Too short', 'Record at least a second of speech.');
        else onRecorded(recorder.uri, duration);
      }
    } catch (e: any) {
      Alert.alert('Could not save recording', String(e?.message ?? e));
    } finally {
      stopping.current = false;
      setBusy(false);
    }
  }

  // Auto-stop before the file gets too big to upload
  useEffect(() => {
    if (state.isRecording && seconds >= MAX_SECONDS) stop();
  }, [seconds, state.isRecording]);

  function confirmDelete(s: Session) {
    Alert.alert('Delete recording?', s.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(s.id) },
    ]);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.brand}>听译</Text>
        <Pressable onPress={onSettings} hitSlop={12}>
          <Text style={styles.link}>Settings</Text>
        </Pressable>
      </View>

      <View style={styles.recordArea}>
        <Text style={styles.timer}>{formatTime(seconds)}</Text>
        <View style={styles.levelTrack}>
          <View style={[styles.levelFill, { width: `${level * 100}%` }]} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.isRecording ? 'Stop recording' : 'Start recording'}
          disabled={busy}
          onPress={state.isRecording ? stop : start}
          style={({ pressed }) => [styles.recordButton, pressed && { opacity: 0.85 }, busy && { opacity: 0.5 }]}
        >
          <View style={state.isRecording ? styles.stopIcon : styles.recIcon} />
        </Pressable>
        <Text style={styles.hint}>
          {state.isRecording ? 'Recording Chinese… tap to stop and translate' : 'Tap to record Chinese speech'}
        </Text>
      </View>

      <Text style={styles.section}>Recordings</Text>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={<Text style={styles.empty}>Your translated recordings will appear here.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpen(item.id)} onLongPress={() => confirmDelete(item)} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowMeta}>
                {formatDate(item.createdAt)} · {formatTime(item.duration)}
              </Text>
            </View>
            <Text
              style={[
                styles.badge,
                item.status === 'done' && { color: colors.ok },
                item.status === 'error' && { color: colors.seal },
              ]}
            >
              {item.status === 'processing' ? 'Translating…' : item.status === 'error' ? 'Failed' : `${item.segments.length} lines`}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  brand: { fontSize: 26, fontWeight: '600', color: colors.seal, letterSpacing: 2 },
  link: { fontSize: 16, color: colors.muted },
  recordArea: { alignItems: 'center', paddingVertical: 28 },
  timer: { fontSize: 48, fontWeight: '300', color: colors.ink, fontVariant: ['tabular-nums'] },
  levelTrack: { width: 160, height: 4, borderRadius: 2, backgroundColor: colors.line, marginVertical: 18, overflow: 'hidden' },
  levelFill: { height: 4, backgroundColor: colors.seal },
  recordButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    borderColor: colors.seal,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  recIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.seal },
  stopIcon: { width: 32, height: 32, borderRadius: 6, backgroundColor: colors.seal },
  hint: { marginTop: 16, color: colors.muted, fontSize: 14 },
  section: { fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  empty: { color: colors.faint, fontSize: 15, paddingVertical: 24, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowTitle: { fontSize: 17, color: colors.ink },
  rowMeta: { fontSize: 13, color: colors.muted, marginTop: 3 },
  badge: { fontSize: 13, color: colors.muted, marginLeft: 12 },
});

import * as DocumentPicker from 'expo-document-picker';
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingOptions,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Picker } from '../components';
import { formatDate, formatTime, useColors } from '../theme';
import { baseOf, LANGS, Session, Settings, SOURCE_OPTIONS, Source, Target, TARGET_OPTIONS } from '../types';

// 16 kHz mono AAC is what speech models want and keeps files small (~14 MB per hour).
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
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const BARS = 24;

type Props = {
  sessions: Session[];
  settings: Settings;
  onLanguages: (source: Source, target: Target) => void;
  onRecorded: (audioUri: string, duration: number, title?: string) => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
};

export default function HomeScreen({ sessions, settings, onLanguages, onRecorded, onOpen, onSettings }: Props) {
  const c = useColors();
  const recorder = useAudioRecorder(SPEECH_PRESET);
  const state = useAudioRecorderState(recorder, 120);
  const [busy, setBusy] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0));
  const stopping = useRef(false);
  const recording = state.isRecording;
  const seconds = state.durationMillis / 1000;

  // Scrolling level meter. Metering is in dBFS (about -60 quiet .. 0 loud).
  useEffect(() => {
    if (!recording) return;
    const level = state.metering != null ? Math.min(1, Math.max(0, (state.metering + 55) / 50)) : 0;
    setLevels((prev) => [level, ...prev.slice(0, BARS - 1)]);
  }, [state.durationMillis]);

  function setSource(source: Source) {
    let target = settings.target;
    if (baseOf(source) === target) target = source === 'en' ? 'zh' : 'en';
    onLanguages(source, target);
  }
  function setTarget(target: Target) {
    onLanguages(settings.source, target);
  }
  function swap() {
    if (recording) return;
    const source = settings.target as Source;
    let target = baseOf(settings.source) as Target;
    if (baseOf(source) === target) target = source === 'en' ? 'zh' : 'en';
    onLanguages(source, target);
  }

  async function start() {
    setBusy(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access for Tingyi in your phone settings to record.');
        return;
      }
      if (Platform.OS === 'android') {
        // Lets Android show the "recording" notification that keeps recording alive with the screen off
        try {
          await requestNotificationPermissionsAsync();
        } catch {}
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setLevels(Array(BARS).fill(0));
    } catch (e: any) {
      Alert.alert('Couldn’t start recording', String(e?.message ?? e));
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
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, allowsBackgroundRecording: false });
      if (recorder.uri) {
        if (duration < 1) Alert.alert('Too short', 'Record at least a second of speech.');
        else onRecorded(recorder.uri, duration);
      }
    } catch (e: any) {
      Alert.alert('Couldn’t save the recording', String(e?.message ?? e));
    } finally {
      stopping.current = false;
      setBusy(false);
    }
  }

  // Stop before the file gets too big to upload
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop();
  }, [seconds, recording]);

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        Alert.alert('File too large', 'Audio files can be up to 25 MB. Trim it, or record at a lower quality.');
        return;
      }
      // Keep a copy with the app so its lines can be replayed later
      const ext = (asset.name.split('.').pop() || 'm4a').toLowerCase();
      const dest = new File(Paths.document, `upload-${Date.now()}.${ext}`);
      new File(asset.uri).copy(dest);
      onRecorded(dest.uri, 0, asset.name.replace(/\.[^.]+$/, ''));
    } catch (e: any) {
      Alert.alert('Couldn’t open that file', String(e?.message ?? e));
    }
  }

  const targetDisabled = [baseOf(settings.source)] as Target[];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[styles.brand, { color: c.accent }]}>听译</Text>
        <Pressable onPress={onSettings} hitSlop={12} disabled={recording}>
          <Text style={{ fontSize: 16, color: recording ? c.faint : c.muted }}>Settings</Text>
        </Pressable>
      </View>

      {!settings.serverUrl ? (
        <Pressable onPress={onSettings} style={[styles.notice, { backgroundColor: c.warnSoft }]}>
          <Text style={{ color: c.warn, fontSize: 14 }}>Add your server address and access code in Settings before translating. Tap here.</Text>
        </Pressable>
      ) : null}

      <View style={styles.langbar} pointerEvents={recording ? 'none' : 'auto'}>
        <Picker label="Spoken" value={settings.source} options={SOURCE_OPTIONS} onChange={setSource} colors={c} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Swap languages"
          onPress={swap}
          style={[styles.swap, { borderColor: c.line, backgroundColor: c.card }]}
        >
          <Text style={{ color: c.accent, fontSize: 20 }}>⇄</Text>
        </Pressable>
        <Picker label="Translate into" value={settings.target} options={TARGET_OPTIONS} disabled={targetDisabled} onChange={setTarget} colors={c} />
      </View>

      <View style={styles.recordArea}>
        <Text style={[styles.timer, { color: c.ink }]}>{formatTime(seconds)}</Text>
        <View style={styles.meter}>
          {levels.map((l, i) => (
            <View key={i} style={{ width: 4, height: 4 + l * 32, borderRadius: 2, backgroundColor: recording ? c.rec : c.line }} />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          disabled={busy}
          onPress={recording ? stop : start}
          style={({ pressed }) => [styles.recordButton, { borderColor: c.rec, backgroundColor: c.card }, (pressed || busy) && { opacity: 0.7 }]}
        >
          <View style={recording ? [styles.stopIcon, { backgroundColor: c.rec }] : [styles.recIcon, { backgroundColor: c.rec }]} />
        </Pressable>
        <Text style={[styles.hint, { color: c.muted }]}>
          {recording
            ? 'Recording. You can lock your phone; it keeps going.\nTap to stop and translate.'
            : `Tap to record ${LANGS[settings.source]}.\nIt will be translated into ${LANGS[settings.target as Source]}.`}
        </Text>
        {!recording ? (
          <Pressable onPress={pickFile} style={[styles.upload, { borderColor: c.line }]}>
            <Text style={{ color: c.muted, fontSize: 14 }}>Or translate an audio file from your phone</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.section, { color: c.muted }]}>Recordings</Text>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={<Text style={[styles.empty, { color: c.faint }]}>Your translated recordings will appear here.</Text>}
        renderItem={({ item }) => {
          const first = item.segments[0];
          const sub =
            item.status === 'processing'
              ? 'Translating…'
              : item.status === 'error'
                ? 'Failed. Tap to try again.'
                : first?.translation || 'No speech found';
          return (
            <Pressable onPress={() => onOpen(item.id)} disabled={recording} style={[styles.row, { borderBottomColor: c.line }]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
                <Text style={[styles.rowTitle, { color: c.ink }, /[㐀-鿿]/.test(item.title) && { fontFamily: 'serif' }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ fontSize: 13, color: c.faint }}>{formatDate(item.createdAt)}</Text>
              </View>
              <Text style={{ fontSize: 14, color: item.status === 'error' ? c.rec : c.muted, marginTop: 3 }} numberOfLines={1}>
                {LANGS[item.source]} → {LANGS[item.target as Source]} · {sub}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  brand: { fontSize: 28, fontWeight: '600', letterSpacing: 3 },
  notice: { borderRadius: 10, padding: 12, marginBottom: 12 },
  langbar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  swap: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  recordArea: { alignItems: 'center', paddingTop: 22, paddingBottom: 14, gap: 12 },
  timer: { fontSize: 50, fontWeight: '300', fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', gap: 3, alignItems: 'center', height: 36 },
  recordButton: { width: 88, height: 88, borderRadius: 44, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  recIcon: { width: 60, height: 60, borderRadius: 30 },
  stopIcon: { width: 32, height: 32, borderRadius: 7 },
  hint: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  upload: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  section: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  empty: { fontSize: 15, paddingVertical: 24, textAlign: 'center' },
  row: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { flex: 1, fontSize: 17, fontWeight: '500' },
});

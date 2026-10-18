import * as DocumentPicker from 'expo-document-picker';
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingOptions,
  RecordingStatus,
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LangBubble } from '../components';
import { formatTime, useColors } from '../theme';
import { baseOf, fixPair, LANGS, Settings, sourceOptions, Source, Target, targetOptions } from '../types';

// 16 kHz mono AAC is what speech models want and keeps files small (~14 MB per hour).
export const SPEECH_PRESET: RecordingOptions = {
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
const BIRD = require('../../assets/bird.png');

export type StopReason = 'user' | 'limit' | 'lost';

type Props = {
  settings: Settings;
  onLanguages: (source: Source, target: Target) => void;
  onRecorded: (audioUri: string, duration: number, title?: string) => void;
  onStopped: (reason: StopReason, duration: number) => void;
  onBusy: (busy: boolean) => void;
  onStartLive: (mode: 'subtitles' | 'conversation') => void;
  onSettings: () => void;
};

export default function RecordScreen({ settings, onLanguages, onRecorded, onStopped, onBusy, onStartLive, onSettings }: Props) {
  const c = useColors();
  const active = useRef(false); // we started a recording and haven't finished handling it
  const stopping = useRef(false);
  const recorder = useAudioRecorder(SPEECH_PRESET, (st: RecordingStatus) => {
    // The system ended the recording (a call took the microphone, an error…): keep what was recorded
    if ((st.isFinished || st.hasError) && active.current && !stopping.current) finish('lost', st.url || undefined);
  });
  const state = useAudioRecorderState(recorder, 120);
  const [busy, setBusy] = useState(false);
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0));
  const [rec, setRec] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;
  const seconds = state.durationMillis / 1000;

  useEffect(() => onBusy(rec), [rec]);
  useEffect(() => () => onBusy(false), []);

  // Scrolling level meter. Metering is in dBFS (about -60 quiet .. 0 loud).
  useEffect(() => {
    if (!state.isRecording) return;
    const level = state.metering != null ? Math.min(1, Math.max(0, (state.metering + 55) / 50)) : 0;
    setLevels((prev) => [level, ...prev.slice(0, BARS - 1)]);
  }, [state.durationMillis]);

  // Backup check: recorder no longer recording although nobody stopped it
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (rec && !state.isRecording && !stopping.current) {
      lostTimer.current = setTimeout(() => {
        if (active.current && !stopping.current && !recorder.getStatus().isRecording) finish('lost');
      }, 2500);
    }
    return () => {
      if (lostTimer.current) clearTimeout(lostTimer.current);
    };
  }, [rec, state.isRecording]);

  useEffect(() => {
    if (!rec) {
      glow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [rec]);

  function pick(source: Source, target: Target) {
    const p = fixPair(settings.langs, source, target);
    onLanguages(p.source, p.target);
  }
  const setSource = (source: Source) => pick(source, settings.target);
  const setTarget = (target: Target) => pick(settings.source, target);
  function swap() {
    if (rec) return;
    pick(settings.target, baseOf(settings.source));
  }

  async function start() {
    setBusy(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Allow microphone access for ChatTalk in your phone settings to record.');
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
      stopping.current = false;
      active.current = true;
      setRec(true);
      setLevels(Array(BARS).fill(0));
    } catch (e: any) {
      Alert.alert('Couldn’t start recording', String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(reason: StopReason, url?: string) {
    if (stopping.current || !active.current) return;
    stopping.current = true;
    setBusy(true);
    const duration = recorder.currentTime || seconds;
    try {
      try {
        await recorder.stop();
      } catch {}
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, allowsBackgroundRecording: false }).catch(() => {});
      const uri = recorder.uri || url;
      onStopped(reason, duration);
      if (uri) {
        if (duration < 1) Alert.alert('Too short', 'Record at least a second of speech.');
        else onRecorded(uri, duration);
      }
    } catch (e: any) {
      Alert.alert('Couldn’t save the recording', String(e?.message ?? e));
    } finally {
      active.current = false;
      stopping.current = false;
      setRec(false);
      setBusy(false);
    }
  }

  // Stop before the file gets too big to upload
  useEffect(() => {
    if (rec && seconds >= MAX_SECONDS) finish('limit');
  }, [seconds, rec]);

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

  const ring = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <ScrollView contentContainerStyle={styles.root}>
      {!settings.serverUrl ? (
        <Pressable onPress={onSettings} style={[styles.notice, { backgroundColor: c.warnSoft }]}>
          <Text style={{ color: c.warn, fontSize: 14, fontWeight: '600' }}>
            Add your server address and access code in Settings before translating. Tap here.
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.langbar} pointerEvents={rec ? 'none' : 'auto'}>
        <LangBubble label="Spoken" value={settings.source} options={sourceOptions(settings.langs)} onChange={setSource} tone="sky" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Swap languages"
          onPress={swap}
          style={[styles.swap, { borderColor: c.line, backgroundColor: c.surface }]}
        >
          <Text style={{ color: c.ink, fontSize: 19 }}>⇄</Text>
        </Pressable>
        <LangBubble
          label="Translate into"
          value={settings.target}
          options={targetOptions(settings.langs)}
          disabled={[baseOf(settings.source)]}
          onChange={setTarget}
          tone="yellow"
        />
      </View>

      <View style={styles.recordArea}>
        <Text style={[styles.timer, { color: c.ink }]}>{formatTime(seconds)}</Text>
        <View style={styles.meter}>
          {levels.map((l, i) => (
            <View key={i} style={{ width: 4, height: 4 + l * 32, borderRadius: 2, backgroundColor: rec ? c.rec : c.line }} />
          ))}
        </View>
        <View style={styles.recWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.halo,
              { backgroundColor: c.rec, opacity: rec ? 0.16 : 0.12, transform: [{ scale: rec ? ring : 1 }] },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rec ? 'Stop recording' : 'Start recording'}
            disabled={busy}
            onPress={rec ? () => finish('user') : start}
            style={({ pressed }) => [styles.recordButton, { borderColor: c.rec }, (pressed || busy) && { opacity: 0.8 }]}
          >
            <Image source={BIRD} style={styles.bird} resizeMode="contain" />
          </Pressable>
          {rec ? (
            <View pointerEvents="none" style={[styles.stopBadge, { backgroundColor: c.rec, borderColor: c.bg }]}>
              <View style={styles.stopIcon} />
            </View>
          ) : null}
        </View>
        <Text style={[styles.hint, { color: c.muted }]}>
          {rec
            ? 'Recording. You can lock your phone; it keeps going.\nTap to stop and translate.'
            : `Tap to record ${LANGS[settings.source]}.\nTap again to stop and translate into ${LANGS[settings.target]}.`}
        </Text>
      </View>

      {!rec ? (
        <>
          <Pressable onPress={pickFile} style={[styles.upload, { borderColor: c.line }]}>
            <Text style={{ color: c.muted, fontSize: 14, fontWeight: '600' }}>Or translate an audio file from your phone</Text>
          </Pressable>
          <View style={styles.liveRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onStartLive('subtitles')}
              style={[styles.liveBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}
            >
              <Text style={{ color: c.accent, fontWeight: '800', fontSize: 14 }}>◉ Live subtitles</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => onStartLive('conversation')}
              style={[styles.liveBtn, { borderColor: c.yellow, backgroundColor: c.yellowSoft }]}
            >
              <Text style={{ color: c.yellowText, fontWeight: '800', fontSize: 14 }}>⇄ Live conversation</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingBottom: 40 },
  notice: { borderRadius: 10, padding: 12, marginBottom: 12 },
  langbar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  swap: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  recordArea: { alignItems: 'center', paddingTop: 26, paddingBottom: 18, gap: 14 },
  timer: { fontSize: 52, fontWeight: '300', fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', gap: 3, alignItems: 'center', height: 36 },
  recWrap: { width: 156, height: 156, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 140, height: 140, borderRadius: 70 },
  recordButton: { width: 120, height: 120, borderRadius: 60, borderWidth: 5, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bird: { width: 104, height: 104, borderRadius: 52 },
  stopBadge: { position: 'absolute', right: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  stopIcon: { width: 13, height: 13, borderRadius: 3, backgroundColor: '#FFFFFF' },
  hint: { fontSize: 14, textAlign: 'center', lineHeight: 20, fontWeight: '500' },
  upload: { alignSelf: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  liveRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 26 },
  liveBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
});

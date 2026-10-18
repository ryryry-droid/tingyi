import { AudioStreamBuffer, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, ScrollViewInstance, StyleSheet, Text, View } from 'react-native';

import { ApiError, liveTranscribe, liveTranslate, makeTitle, options } from '../api';
import { Btn, Pinyin } from '../components';
import { deleteAudio } from '../storage';
import { formatDate, formatTime, HAN_FONT, useColors } from '../theme';
import { baseOf, isChinese, LANGS, Segment, Session, Settings } from '../types';

// Audio is captured as 16 kHz PCM, cut into chunks at natural pauses, and each chunk is sent for
// transcription. Lines show up straight away; translations are fetched one batch at a time, so when
// speech is fast several lines share one request (kind to free-plan rate limits). The whole session
// is also written to a WAV file so lines can be replayed later.
const LIVE = { minChunk: 3.0, maxChunk: 12, pause: 0.6, minSpeech: 0.4, rate: 16000 };
const METER = 16;

type Line = {
  id: number;
  start: number;
  end: number;
  text: string;
  pinyin?: string | null;
  lang: string;
  target: string;
  translation: string | null;
  translation_pinyin?: string | null;
  busy?: boolean;
  tries?: number;
  failed?: boolean;
};

export type LiveResult = { session: Session | null; reason: 'user' | 'lost' | 'error'; message?: string };

type Props = {
  mode: 'subtitles' | 'conversation';
  settings: Settings;
  buzz: (kind: 'stopped' | 'alert') => void;
  toast: (msg: string) => void;
  onDone: (r: LiveResult) => void;
};

function wavBytes(frames: Int16Array[], rate: number): Uint8Array {
  const n = frames.reduce((a, f) => a + f.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  const out = new Int16Array(buf, 44);
  let o = 0;
  for (const f of frames) {
    out.set(f, o);
    o += f.length;
  }
  return new Uint8Array(buf);
}

export default function LiveScreen({ mode, settings, buzz, toast, onDone }: Props) {
  const c = useColors();
  const conv = mode === 'conversation';
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [levels, setLevels] = useState<number[]>(Array(METER).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);
  const nearBottom = useRef(true);

  const L = useRef({
    source: settings.source as string,
    target: settings.target as string,
    script: settings.script,
    startedAt: Date.now(),
    lines: [] as Line[],
    nextId: 0,
    order: Promise.resolve() as Promise<void>,
    inflight: 0,
    translating: false,
    frames: [] as Int16Array[],
    chunkStart: 0,
    total: 0,
    speech: 0,
    silence: 0,
    noise: 0.004,
    rate: LIVE.rate,
    ready: false,
    stopping: false,
    done: false,
    fullUri: '',
    chunkNo: 0,
    lastLevel: 0,
  }).current;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const { stream, isStreaming } = useAudioStream({ sampleRate: LIVE.rate, channels: 1, encoding: 'int16', onBuffer });

  // ---------- capture ----------
  function onBuffer(buf: AudioStreamBuffer) {
    if (!L.ready || L.stopping) return;
    L.rate = buf.sampleRate || LIVE.rate;
    const frame = new Int16Array(buf.data.slice(0));
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      const x = frame[i] / 32768;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / Math.max(1, frame.length));
    // Track the background noise level and call it speech when clearly above it
    L.noise = rms < L.noise ? rms : L.noise + (rms - L.noise) * 0.01;
    const speaking = rms > Math.max(0.01, L.noise * 3);
    const secs = frame.length / L.rate;
    L.frames.push(frame);
    L.total += frame.length;
    if (speaking) {
      L.speech += secs;
      L.silence = 0;
    } else L.silence += secs;
    const level = Math.min(1, rms * 12);
    setLevels((prev) => [level, ...prev.slice(0, METER - 1)]);

    const chunkSecs = (L.total - L.chunkStart) / L.rate;
    if (L.speech === 0 && chunkSecs > 1.2) {
      // Nothing said yet: keep only a short lead-in so chunks don't fill with silence
      while (L.frames.length > 3) {
        const f = L.frames.shift()!;
        L.chunkStart += f.length;
      }
      return;
    }
    if ((chunkSecs >= LIVE.minChunk && L.silence >= LIVE.pause && L.speech >= LIVE.minSpeech) || chunkSecs >= LIVE.maxChunk) {
      flushChunk();
    }
  }

  function flushChunk() {
    if (!L.frames.length) return;
    const frames = L.frames;
    const offset = L.chunkStart / L.rate;
    const speech = L.speech;
    L.frames = [];
    L.chunkStart = L.total;
    L.speech = 0;
    L.silence = 0;
    if (speech < LIVE.minSpeech) return; // just noise
    sendChunk(wavBytes(frames, L.rate), offset);
  }

  const liveOpts = (source = L.source, target = L.target) => options(settingsRef.current, source, target, L.script);

  function sendChunk(bytes: Uint8Array, offset: number) {
    const file = new File(Paths.cache, `live-${Date.now()}-${L.chunkNo++}.wav`);
    L.inflight++;
    bump();
    const request = (async () => {
      file.create({ overwrite: true });
      file.write(bytes);
      try {
        return await liveTranscribe(settingsRef.current, file.uri, liveOpts(), offset, conv);
      } finally {
        try {
          file.delete();
        } catch {}
      }
    })();
    // Results are added in the order the chunks were spoken, even if replies arrive out of order
    L.order = L.order.then(async () => {
      try {
        const data = await request;
        for (const seg of data.segments) L.lines.push({ ...seg, id: L.nextId++, translation: null });
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 401) {
          stopLive('error', 'Wrong or missing access code. Check it in Settings.');
        } else toast(e instanceof ApiError && e.status === -1 ? 'Connection problem. Still listening…' : 'Missed a few seconds. Still listening…');
      } finally {
        L.inflight--;
        bump();
        pumpTranslate();
      }
    });
  }

  async function pumpTranslate() {
    if (L.translating || L.done) return;
    const waiting = L.lines.filter((l) => l.translation === null && !l.busy);
    if (!waiting.length) {
      bump();
      return;
    }
    const dir = (l: Line) => `${l.lang}>${l.target}`;
    const batch = waiting.filter((l) => dir(l) === dir(waiting[0])).slice(0, 8);
    const context = L.lines
      .filter((l) => l.translation)
      .slice(-4)
      .map((l) => ({ text: l.text, translation: l.translation || '' }));
    L.translating = true;
    batch.forEach((l) => (l.busy = true));
    bump();
    try {
      const data = await liveTranslate(
        settingsRef.current,
        batch.map((l) => ({ id: l.id, text: l.text })),
        context,
        liveOpts(batch[0].lang, batch[0].target),
      );
      for (const t of data.translations) {
        const line = L.lines.find((l) => l.id === t.id);
        if (line) {
          line.translation = t.translation || '—';
          line.translation_pinyin = t.translation_pinyin;
        }
      }
    } catch {
      batch.forEach((l) => {
        l.tries = (l.tries || 0) + 1;
        if (l.tries >= 3) {
          l.translation = '';
          l.failed = true;
        }
      });
      await new Promise((r) => setTimeout(r, 1500));
    } finally {
      batch.forEach((l) => (l.busy = false));
      L.translating = false;
      bump();
      pumpTranslate();
    }
  }

  // ---------- start / stop ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          onDone({ session: null, reason: 'error', message: 'Allow microphone access for ChatTalk in your phone settings to use live translation.' });
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false });
        await activateKeepAwakeAsync('live').catch(() => {});
        await stream.start();
        const { uri } = await stream.startFileRecordingAsync({ directory: 'document', format: 'wav' });
        if (cancelled) return;
        L.fullUri = uri;
        L.startedAt = Date.now();
        L.ready = true;
        bump();
      } catch (e: any) {
        onDone({ session: null, reason: 'error', message: `Couldn’t start live translation: ${String(e?.message ?? e)}` });
      }
    })();
    const tick = setInterval(() => {
      if (!L.stopping) setElapsed((Date.now() - L.startedAt) / 1000);
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(tick);
      L.done = true;
      try {
        stream.stop();
      } catch {}
      deactivateKeepAwake('live');
    };
  }, []);

  // The microphone was taken away (a call, another app): stop and keep what we have
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (isStreaming) wasStreaming.current = true;
    else if (wasStreaming.current && L.ready && !L.stopping) stopLive('lost');
  }, [isStreaming]);

  async function stopLive(reason: 'user' | 'lost' | 'error', message?: string) {
    if (L.stopping) return;
    L.stopping = true;
    bump();
    buzz(reason === 'user' ? 'stopped' : 'alert');
    flushChunk();
    let duration = (Date.now() - L.startedAt) / 1000;
    try {
      const r = await stream.stopFileRecordingAsync();
      if (r?.uri) L.fullUri = r.uri;
      if (r?.duration) duration = r.duration;
    } catch {}
    try {
      stream.stop();
    } catch {}
    deactivateKeepAwake('live');
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, allowsBackgroundRecording: false }).catch(() => {});
    await L.order;
    // Give translations up to ~30 seconds to finish
    for (let i = 0; i < 60 && L.lines.some((l) => l.translation === null); i++) {
      pumpTranslate();
      await new Promise((r) => setTimeout(r, 500));
    }
    L.done = true;

    if (!L.lines.length) {
      if (L.fullUri) deleteAudio(L.fullUri);
      onDone({
        session: null,
        reason,
        message:
          message ||
          (reason === 'lost'
            ? 'Live translation stopped: the microphone was taken by another app or a call. Nothing was heard.'
            : 'Nothing was heard, so nothing was saved.'),
      });
      return;
    }
    const now = L.startedAt;
    const segments: Segment[] = L.lines.map((l) => ({
      id: l.id,
      start: l.start,
      end: l.end,
      text: l.text,
      pinyin: l.pinyin,
      translation: l.translation || '',
      translation_pinyin: l.translation_pinyin || null,
      lang: l.lang,
      target: l.target,
    }));
    const session: Session = {
      id: String(now),
      createdAt: now,
      duration,
      mode,
      source: L.source as Session['source'],
      target: L.target as Session['target'],
      script: L.script,
      status: 'done',
      audioUri: L.fullUri,
      title: (conv ? 'Conversation ' : 'Live ') + formatDate(now),
      segments,
    };
    try {
      const t = await makeTitle(
        settingsRef.current,
        segments.slice(0, 40).map((x) => ({ text: x.text, translation: x.translation })),
        liveOpts(),
      );
      if (t) session.title = t;
    } catch {}
    onDone({
      session,
      reason,
      message:
        message ||
        (reason === 'lost'
          ? 'Live translation stopped by itself: the microphone was taken by another app or a call. Everything up to then is saved.'
          : undefined),
    });
  }

  // ---------- render ----------
  const busy = L.inflight > 0 || L.translating;
  const state = L.stopping ? 'Finishing the last lines…' : !L.ready ? 'Starting…' : busy ? 'Listening · translating…' : 'Listening…';
  const han = (code: string) => isChinese(code);

  function trView(l: Line, inBubble?: boolean, ink?: string) {
    if (l.translation === null || l.failed) {
      return (
        <Text style={[styles.pending, { color: ink || c.faint }, inBubble && { opacity: 0.8 }]}>
          {l.failed ? 'Couldn’t translate this line' : 'translating…'}
        </Text>
      );
    }
    return (
      <>
        <Text style={[inBubble ? styles.bt : styles.t, { color: ink || c.ink }, han(l.target) && styles.han]}>{l.translation}</Text>
        {settings.pinyin && l.translation_pinyin ? <Pinyin value={l.translation_pinyin} size={13} style={inBubble ? { opacity: 0.85 } : undefined} /> : null}
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.head, { borderBottomColor: c.line }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mode, { color: c.ink }]}>{conv ? 'Live conversation' : 'Live subtitles'}</Text>
          <Text style={[styles.meta, { color: c.muted }]}>
            {conv ? `${LANGS[L.source]} ⇄ ${LANGS[L.target]} · detected automatically` : `${LANGS[L.source]} → ${LANGS[L.target]}`}
          </Text>
        </View>
        <View style={styles.status}>
          <View style={[styles.liveDot, { backgroundColor: L.stopping ? c.faint : c.rec }]} />
          <Text style={{ color: c.muted, fontVariant: ['tabular-nums'], fontWeight: '600' }}>{formatTime(elapsed)}</Text>
        </View>
      </View>

      <ScrollView
        ref={scroller}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10 }}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          nearBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 140;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => nearBottom.current && scroller.current?.scrollToEnd({ animated: true })}
      >
        {!L.lines.length ? (
          <Text style={[styles.empty, { color: c.muted }]}>
            {conv
              ? `Start talking. Speak ${LANGS[L.source]} or ${LANGS[L.target]}, and pause briefly after each sentence.`
              : `Listening for ${LANGS[L.source]}. Lines appear a few seconds after each sentence.`}
            {'\n\n'}Keep this screen open while you talk.
          </Text>
        ) : conv ? (
          <View style={{ gap: 10 }}>
            {L.lines.map((l) => {
              const a = baseOf(l.lang) === baseOf(L.source);
              const ink = a ? c.skyInk : c.yellowInk;
              return (
                <View
                  key={l.id}
                  style={[
                    styles.bubble,
                    a
                      ? { alignSelf: 'flex-start', backgroundColor: c.sky, borderBottomLeftRadius: 5 }
                      : { alignSelf: 'flex-end', backgroundColor: c.yellow, borderBottomRightRadius: 5 },
                  ]}
                >
                  <Text style={[styles.who, { color: ink }]}>{LANGS[l.lang]?.toUpperCase()}</Text>
                  <Text style={[styles.bo, { color: ink }, han(l.lang) && styles.han]}>{l.text}</Text>
                  {trView(l, true, ink)}
                </View>
              );
            })}
          </View>
        ) : (
          L.lines.map((l) => (
            <View key={l.id} style={[styles.line, { borderBottomColor: c.line }]}>
              <Text style={[styles.o, { color: han(l.lang) ? c.ink : c.muted }, han(l.lang) && styles.han]}>{l.text}</Text>
              {settings.pinyin && l.pinyin ? <Pinyin value={l.pinyin} /> : null}
              {trView(l)}
            </View>
          ))
        )}
        <View style={styles.listening}>
          <View style={styles.mini}>
            {levels.map((v, i) => (
              <View key={i} style={{ width: 3, height: 3 + v * 15, borderRadius: 2, backgroundColor: c.rec }} />
            ))}
          </View>
          <Text style={{ color: c.faint, fontSize: 13 }}>{state}</Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Btn title={L.stopping ? 'Finishing…' : 'Stop'} kind="stop" disabled={L.stopping} onPress={() => stopLive('user')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  mode: { fontSize: 17, fontWeight: '800' },
  meta: { fontSize: 13, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  empty: { textAlign: 'center', paddingVertical: 40, paddingHorizontal: 10, fontSize: 15, lineHeight: 22 },
  line: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  o: { fontSize: 18, lineHeight: 27 },
  t: { fontSize: 20, lineHeight: 28, fontWeight: '600', marginTop: 6 },
  han: { fontFamily: HAN_FONT },
  pending: { fontSize: 15, marginTop: 6 },
  bubble: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, gap: 4 },
  who: { fontSize: 11, fontWeight: '800', letterSpacing: 1, opacity: 0.8 },
  bo: { fontSize: 15, opacity: 0.8 },
  bt: { fontSize: 19, lineHeight: 26, fontWeight: '800' },
  listening: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: 4 },
  mini: { flexDirection: 'row', gap: 2, alignItems: 'center', height: 18 },
  actions: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
});

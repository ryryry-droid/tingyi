import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Btn, TextBtn } from '../components';
import { speakText, stopSpeaking } from '../speech';
import { HAN_FONT, useColors } from '../theme';
import { Settings, TestSetup, Word } from '../types';
import { testPool } from './WordsScreen';

// Listening: example sentences read aloud, each twice, then a pause, then the next
const REPEATS = 2;
const GAP = 1200; // ms between the two plays
const PAUSE = 3500; // ms before the next sentence
const SHOW_KEY = 'chattalk.listenShow';

const shuffle = <T,>(xs: T[]): T[] => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

type Props = { settings: Settings; words: Word[]; setup: TestSetup; onDone: () => void };

export default function ListenScreen({ settings, words, setup, onDone }: Props) {
  useKeepAwake(); // keep the screen on while it plays
  const c = useColors();
  const [items] = useState(() => {
    let pool = testPool(words, setup.group).filter((w) => w.example?.text);
    const n = [5, 10, 20].includes(setup.count) && setup.count < pool.length ? setup.count : pool.length;
    return setup.group === 'weak' ? shuffle(pool.slice(0, n)) : shuffle(pool).slice(0, n);
  });
  const [i, setI] = useState(0);
  const [rep, setRep] = useState(0);
  const [phase, setPhase] = useState<'play' | 'gap' | 'next'>('play');
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(!items.length);
  const [show, setShow] = useState(true);
  const run = useRef(0); // bumps on every jump/pause, so an old sequence stops itself

  useEffect(() => {
    AsyncStorage.getItem(SHOW_KEY).then((v) => v === '0' && setShow(false)).catch(() => {});
    return () => {
      run.current++;
      stopSpeaking();
    };
  }, []);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function playFrom(start: number) {
    const id = ++run.current;
    stopSpeaking();
    setPaused(false);
    setDone(false);
    for (let k = start; k < items.length; k++) {
      setI(k);
      for (let r = 0; r < REPEATS; r++) {
        if (run.current !== id) return;
        setRep(r);
        setPhase('play');
        await speakText(items[k].example!.text, items[k].lang, settings.script);
        if (run.current !== id) return;
        setPhase(r + 1 < REPEATS ? 'gap' : 'next');
        await wait(r + 1 < REPEATS ? GAP : PAUSE);
      }
    }
    if (run.current === id) setDone(true);
  }

  useEffect(() => {
    if (items.length) playFrom(0);
  }, []);

  function pause() {
    run.current++;
    stopSpeaking();
    setPaused(true);
  }

  // the little sound-wave while a sentence is being read
  const wave = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (phase === 'play' && !paused && !done) {
      const loop = Animated.loop(Animated.timing(wave, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
      loop.start();
      return () => loop.stop();
    }
    wave.setValue(0);
  }, [phase, paused, done]);

  if (done) {
    return (
      <View style={styles.body}>
        <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
          <Text style={{ fontSize: 48 }}>🎧</Text>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>
            {items.length ? `All ${items.length} sentences played` : 'None of these words have an example sentence yet'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {items.length ? <Btn title="Listen again" onPress={() => playFrom(0)} /> : null}
          <Btn title="Back to words" kind="secondary" onPress={onDone} />
        </View>
      </View>
    );
  }

  const w = items[i];
  const han = w.lang === 'zh';
  const status = paused ? 'Paused' : phase === 'next' ? 'Next sentence in a moment…' : `Playing ${Math.min(rep + 1, REPEATS)} of ${REPEATS}`;
  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <Text style={{ color: c.muted, fontWeight: '600', fontSize: 13 }}>
          Sentence {i + 1} of {items.length}
        </Text>
        <TextBtn title="Stop" onPress={onDone} />
      </View>
      <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
        <View style={{ width: `${(i / items.length) * 100}%`, height: '100%', backgroundColor: c.accent, borderRadius: 9 }} />
      </View>
      <View style={[styles.card, { backgroundColor: c.surface }]}>
        <View style={styles.wave}>
          {[0, 1, 2, 3, 4].map((k) => (
            <Animated.View
              key={k}
              style={[
                styles.waveBar,
                { backgroundColor: c.accent, opacity: phase === 'play' && !paused ? 1 : 0.5 },
                {
                  transform: [
                    { scaleY: wave.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1 + ((k * 7) % 5) * 0.6 + 0.8, 1] }) },
                  ],
                },
              ]}
            />
          ))}
        </View>
        <Text style={{ color: c.muted, fontWeight: '600', fontSize: 14 }}>{status}</Text>
        {show ? (
          <>
            <Text style={[{ color: c.ink, fontSize: 22, fontWeight: '600', textAlign: 'center', lineHeight: 30, marginTop: 6 }, han && { fontFamily: HAN_FONT }]}>
              {w.example!.text}
            </Text>
            <Text style={{ color: c.muted, fontSize: 16, textAlign: 'center' }}>{w.example!.translation}</Text>
            <Text style={{ color: c.faint, fontSize: 13, textAlign: 'center' }}>
              {w.word} · {w.meaning}
            </Text>
          </>
        ) : (
          <Text style={{ color: c.faint, fontSize: 15, marginVertical: 18 }}>Text hidden. Just listen.</Text>
        )}
        <Pressable
          onPress={() => {
            setShow(!show);
            AsyncStorage.setItem(SHOW_KEY, show ? '0' : '1').catch(() => {});
          }}
          hitSlop={8}
        >
          <Text style={{ color: c.muted, fontWeight: '600', fontSize: 14 }}>{show ? 'Hide text' : 'Show text'}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn title="‹ Back" kind="secondary" disabled={!i} onPress={() => playFrom(i - 1)} style={{ width: 92 }} />
        <Btn title={paused ? '▶ Resume' : '❚❚ Pause'} onPress={() => (paused ? playFrom(i) : pause())} />
        <Btn
          title="Next ›"
          kind="secondary"
          onPress={() => (i + 1 < items.length ? playFrom(i + 1) : (run.current++, stopSpeaking(), setDone(true)))}
          style={{ width: 92 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 16 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bar: { height: 6, borderRadius: 9, overflow: 'hidden' },
  card: { borderRadius: 20, paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center', gap: 10, minHeight: 300, justifyContent: 'center' },
  wave: { flexDirection: 'row', gap: 5, alignItems: 'center', height: 40 },
  waveBar: { width: 6, height: 10, borderRadius: 9 },
});

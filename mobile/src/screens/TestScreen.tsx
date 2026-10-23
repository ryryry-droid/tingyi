import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, TextInput, View } from 'react-native';

import { Btn, Label } from '../components';
import { playCry, playWrong } from '../sounds';
import { speakWord } from '../speech';
import { formatTime, HAN_FONT, toneless, useColors } from '../theme';
import { LANGS, Settings, TestKind, TestSetup, Word } from '../types';
import { liveTranscribe, options } from '../api';
import { afterReview, dueWords, langWords, markReviewDay, nextReview, REVIEW_MAX } from '../review';
import { cleanWord } from '../words';
import { Ladder, testPool } from './WordsScreen';

type Question = { w: Word; kind: TestKind | 'recall'; choices?: Word[] };
type Answer = { ok: boolean; pick?: string; typed?: string; heard?: string };

/** A typed or spoken answer: the word itself, or for Chinese its pinyin (tones optional, homophones heard by the mic count). */
function matches(w: Word, typed: string, heardPinyin = '') {
  const n = toneless(typed);
  if (w.lang === 'zh')
    return typed.replace(/[\s.,!?;:。，！？、；：]/g, '') === w.word || (!!n && n === toneless(w.pinyin)) || (!!heardPinyin && toneless(heardPinyin) === toneless(w.pinyin));
  return !!n && [w.word, w.root].filter(Boolean).some((x) => toneless(x) === n);
}

const shuffle = <T,>(xs: T[]): T[] => {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function makeQuestion(w: Word, words: Word[], kinds: TestKind[]): Question {
  const others = shuffle(words.filter((x) => x.id !== w.id));
  const sameLang = others.filter((x) => x.lang === w.lang);
  const pickDistractors = (key: 'meaning' | 'word') => {
    const seen = new Set([String(w[key]).toLowerCase()]);
    const out: Word[] = [];
    for (const x of [...sameLang, ...others]) {
      const val = String(x[key] || '');
      if (val && !seen.has(val.toLowerCase())) {
        seen.add(val.toLowerCase());
        out.push(x);
      }
      if (out.length === 3) break;
    }
    return out;
  };
  let opts = kinds.filter((k) => k !== 'gap' || (w.example?.text || '').includes(w.word));
  if (!opts.length) opts = ['meaning'];
  const kind = opts[Math.floor(Math.random() * opts.length)];
  if (kind === 'type') return { w, kind };
  return { w, kind, choices: shuffle([w, ...pickDistractors(kind === 'meaning' ? 'meaning' : 'word')]) };
}

type Props = {
  settings: Settings;
  words: Word[];
  setup: TestSetup;
  only?: Word[]; // practise just these (the missed words)
  bank?: Word[]; // a word bank's terms: questions come from these and scores are kept apart from your words
  onBankResult?: (word: string, ok: boolean) => void;
  review?: string; // the daily review of this language ('all': every language): today's due words, recalled from the meaning
  onReviewMore?: () => void;
  onUpdateWord: (w: Word) => void;
  onAgain: (missed: Word[]) => void;
  onNew: () => void;
  onDone: () => void;
  buzzAnswer: (ok: boolean) => void;
};

export default function TestScreen({ settings, words, setup, only, bank, onBankResult, review, onReviewMore, onUpdateWord, onAgain, onNew, onDone, buzzAnswer }: Props) {
  const c = useColors();
  const scroller = useRef<ScrollViewInstance>(null);
  const qs = useMemo((): Question[] => {
    if (review && !only) return dueWords(words, review).slice(0, REVIEW_MAX).map((w) => ({ w, kind: 'recall' }));
    if (bank) {
      const items = only || shuffle(bank).slice(0, 10);
      const kinds = setup.kinds.filter((k) => k !== 'gap'); // the bank has no example sentences
      return items.map((w) => makeQuestion(w, bank, kinds.length ? kinds : ['meaning', 'word']));
    }
    let pool = only || testPool(words, setup.group, setup.theme);
    if (!only) {
      const n = [5, 10, 20].includes(setup.count) && setup.count < pool.length ? setup.count : pool.length;
      pool = shuffle(pool).slice(0, n);
    }
    const kinds = setup.kinds.length ? setup.kinds : (['meaning'] as TestKind[]);
    return pool.map((w) => makeQuestion(w, words, kinds));
  }, []);
  const [count, setCount] = useState(qs.length);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [typed, setTyped] = useState('');
  const [stats, setStats] = useState({ right: 0, streak: 0, best: 0, missed: [] as Word[] });
  const [done, setDone] = useState(false);
  const started = useRef(Date.now());
  const secs = useRef(0);
  const [shown, setShown] = useState<Word[] | null>(null); // review: the choices, once asked for
  const [rec, setRec] = useState(false);
  const [hearing, setHearing] = useState(false);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 });
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const qRef = useRef(0);
  qRef.current = i;
  useEffect(
    () => () => {
      alive.current = false;
      if (micTimer.current) clearTimeout(micTimer.current);
      if (recorder.isRecording) recorder.stop().catch(() => {});
    },
    [],
  );

  async function startMic() {
    if (answer || rec || hearing) return;
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRec(true);
      micTimer.current = setTimeout(() => stopMic(true), 5000);
    } catch {}
  }
  async function stopMic(send: boolean) {
    if (micTimer.current) clearTimeout(micTimer.current);
    setRec(false);
    try {
      await recorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!send || !recorder.uri || !alive.current) return;
    const at = qRef.current;
    const w = qs[at].w;
    setHearing(true);
    try {
      const r = await liveTranscribe(settings, recorder.uri, { ...options(settings, w.lang, w.lang === 'en' ? 'zh' : 'en'), pinyin: true }, 0, false);
      if (!alive.current || qRef.current !== at) return;
      setHearing(false);
      const heard = cleanWord(r.segments.map((x) => x.text).join(' '));
      if (!heard) return;
      setTyped(heard);
      answerWith(matches(w, heard, r.segments.map((x) => x.pinyin || '').join(' ')), { typed: heard, heard });
    } catch {
      if (alive.current) setHearing(false);
    }
  }

  function answerWith(ok: boolean, extra: Partial<Answer>) {
    const w = qs[i].w;
    setAnswer({ ok, ...extra });
    setStats((s) => {
      const streak = ok ? s.streak + 1 : 0;
      return { right: s.right + (ok ? 1 : 0), streak, best: Math.max(s.best, streak), missed: ok ? s.missed : [...s.missed, w] };
    });
    if (bank) {
      onBankResult?.(w.word, ok);
      if (ok) playCry();
      else playWrong();
      buzzAnswer(ok);
      return;
    }
    const cur = words.find((x) => x.id === w.id) || w;
    if (review) markReviewDay();
    onUpdateWord({
      ...cur,
      ...(review ? { srs: afterReview(cur, ok, !!shown) } : {}),
      level: ok ? Math.min(3, (cur.level || 0) + 1) : Math.max(0, (cur.level || 0) - 1),
      right: (cur.right || 0) + (ok ? 1 : 0),
      wrong: (cur.wrong || 0) + (ok ? 0 : 1),
      lastTested: Date.now(),
    });
    if (ok) playCry();
    else playWrong();
    buzzAnswer(ok);
  }

  function checkTyped() {
    const w = qs[i].w;
    const t = typed.trim();
    if (!t) return;
    answerWith(matches(w, t), { typed: t });
  }

  function next() {
    if (i + 1 < count) {
      setI(i + 1);
      setAnswer(null);
      setTyped('');
      setShown(null);
      scroller.current?.scrollTo({ y: 0, animated: false });
    } else finish();
  }
  function finish() {
    secs.current = Math.round((Date.now() - started.current) / 1000);
    setDone(true);
  }
  function quit() {
    if (rec) stopMic(false);
    if (i > 0 || answer) {
      setCount(i + (answer ? 1 : 0));
      finish();
    } else onDone();
  }

  // ---------- results ----------
  if (done) {
    const total = count;
    const pct = Math.round((stats.right / Math.max(1, total)) * 100);
    const left = review ? dueWords(words, review).length : 0;
    const rw = review ? langWords(words, review) : [];
    const msg = review ? (left ? `${left} more due today` : 'All caught up') : pct === 100 ? 'Perfect!' : pct >= 80 ? 'Nice work!' : pct >= 50 ? 'Good effort' : 'Keep practising';
    const nextLine = review && !left && rw.length ? `Next review ${nextReview(rw)}` : '';
    const DOTS = 40;
    return (
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <View style={styles.ring}>
            {Array.from({ length: DOTS }, (_, k) => {
              const a = (k / DOTS) * 2 * Math.PI - Math.PI / 2;
              return (
                <View
                  key={k}
                  style={[
                    styles.ringDot,
                    { left: 75 + 66 * Math.cos(a) - 5, top: 75 + 66 * Math.sin(a) - 5, backgroundColor: k < (pct / 100) * DOTS ? c.yellow : c.surface },
                  ]}
                />
              );
            })}
            <Text style={{ fontSize: 34, fontWeight: '800', color: c.ink }}>
              {stats.right}/{total}
            </Text>
            <Text style={{ fontSize: 12, color: c.muted, fontWeight: '700' }}>correct</Text>
          </View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: c.ink, marginTop: 14 }}>{msg}</Text>
          <Text style={{ color: c.muted, marginTop: 2 }}>
            {nextLine || (stats.missed.length ? `${stats.missed.length} ${stats.missed.length === 1 ? 'word' : 'words'} to practise again` : 'You got every word right')}
          </Text>
        </View>
        <View style={styles.rstats}>
          {[
            [`${pct}%`, 'score'],
            [String(stats.best), 'best streak'],
            [formatTime(secs.current), 'time'],
          ].map(([b, s]) => (
            <View key={s} style={[styles.rstat, { backgroundColor: c.surface }]}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.ink }}>{b}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: c.muted }}>{s}</Text>
            </View>
          ))}
        </View>
        {stats.missed.length ? (
          <>
            <Label style={{ marginTop: 18 }}>Review these</Label>
            {stats.missed.map((w) => (
              <View key={w.id} style={[styles.rv, { borderBottomColor: c.line }]}>
                <Text style={[{ fontSize: 19, fontWeight: '800', color: c.ink }, w.lang === 'zh' && { fontFamily: HAN_FONT }]}>{w.word}</Text>
                <Text style={{ flex: 1, color: c.muted, fontSize: 14 }} numberOfLines={1}>
                  {w.meaning}
                </Text>
                <Text style={{ color: c.rec, fontSize: 11.5, fontWeight: '800' }}>missed</Text>
              </View>
            ))}
          </>
        ) : null}
        {left && onReviewMore ? (
          <View style={{ flexDirection: 'row', marginTop: 16 }}>
            <Btn title={`Review the next ${Math.min(left, REVIEW_MAX)}`} onPress={onReviewMore} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {stats.missed.length ? (
            <Btn title={`Practise the ${stats.missed.length} missed`} onPress={() => onAgain(stats.missed)} />
          ) : (
            <Btn title="New test" onPress={onNew} />
          )}
          <Btn title="Done" kind="secondary" onPress={onDone} />
        </View>
      </ScrollView>
    );
  }

  // ---------- question ----------
  const q = qs[i];
  const w = q.w;
  const han = w.lang === 'zh';
  let prompt: string;
  let card: React.ReactNode;
  if (q.kind === 'meaning') {
    prompt = 'What does this mean?';
    card = (
      <View style={[styles.qcard, { backgroundColor: c.sky }]}>
        <Pressable onPress={() => speakWord(w, settings.script)} style={styles.spk} accessibilityLabel="Say it">
          <Text style={{ fontSize: 15 }}>🔊</Text>
        </Pressable>
        <Text style={[styles.big, han && { fontFamily: HAN_FONT, fontSize: 48 }]}>{w.word}</Text>
        {han && settings.pinyin && w.pinyin ? <Text style={{ color: '#fff', fontSize: 17, opacity: 0.9, marginTop: 4 }}>{w.pinyin}</Text> : null}
      </View>
    );
  } else if (q.kind === 'gap') {
    prompt = 'Which word fills the gap?';
    const parts = (w.example?.text || '').split(w.word);
    card = (
      <View style={[styles.qcard, { backgroundColor: c.yellow, borderBottomLeftRadius: 22, borderBottomRightRadius: 6, alignItems: 'flex-start' }]}>
        <Text style={[{ fontSize: 21, fontWeight: '800', color: c.yellowInk, lineHeight: 32 }, han && { fontFamily: HAN_FONT }]}>
          {parts.map((part, k) => (
            <Text key={k}>
              {part}
              {k < parts.length - 1 ? '＿＿＿' : ''}
            </Text>
          ))}
        </Text>
        <Text style={{ fontSize: 14, marginTop: 6, color: c.yellowInk, opacity: 0.8, fontWeight: '700' }}>{w.example?.translation}</Text>
      </View>
    );
  } else if (q.kind === 'recall') {
    prompt = '';
    card = (
      <View style={[styles.qcard, { backgroundColor: c.sky }]}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{w.meaning}</Text>
        <Text style={{ color: '#fff', opacity: 0.85, fontSize: 13.5, fontWeight: '600', marginTop: 6 }}>
          {LANGS[w.lang] || w.lang}
          {w.part_of_speech ? ` · ${w.part_of_speech}` : ''}
        </Text>
      </View>
    );
  } else {
    prompt = q.kind === 'type' ? (han ? 'Type this word, in characters or pinyin' : `Type this word in ${LANGS[w.lang] || 'the language'}`) : 'Which word means this?';
    card = (
      <View style={[styles.qcard, { backgroundColor: c.sky }]}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{w.meaning}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroller} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 250 }} keyboardShouldPersistTaps="handled">
        <View style={styles.qtop}>
          <Pressable onPress={quit} style={[styles.qx, { backgroundColor: c.surface }]} accessibilityLabel="End test">
            <Text style={{ color: c.muted, fontSize: 15 }}>✕</Text>
          </Pressable>
          <View style={[styles.qbar, { backgroundColor: c.surface }]}>
            <View style={{ height: '100%', borderRadius: 5, backgroundColor: c.yellow, width: `${Math.round(((i + (answer ? 1 : 0)) / count) * 100)}%` }} />
          </View>
          <Text style={{ color: c.muted, fontWeight: '700', fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {i + 1} / {count}
          </Text>
        </View>
        {prompt ? <Text style={{ marginTop: 14, color: c.muted, fontWeight: '700', fontSize: 13.5 }}>{prompt}</Text> : <View style={{ height: 8 }} />}
        {card}

        {q.kind === 'recall' && !shown ? (
          <View style={{ marginTop: 18, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <TextInput
                value={answer ? answer.typed : typed}
                onChangeText={setTyped}
                editable={!answer && !rec && !hearing}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={checkTyped}
                placeholder={hearing ? 'Listening back…' : rec ? 'Listening…' : 'Type the word'}
                placeholderTextColor={c.faint}
                style={[styles.typeInput, { flex: 1, minWidth: 0, width: 0, borderColor: c.line, backgroundColor: c.surface, color: c.ink }, han && { fontFamily: HAN_FONT }]}
              />
              <Pressable
                onPress={() => (rec ? stopMic(true) : startMic())}
                disabled={!!answer || hearing}
                style={[styles.mic, { backgroundColor: c.rec }, (!!answer || hearing) && { opacity: 0.5 }]}
                accessibilityLabel={rec ? 'Stop' : 'Say it'}
              >
                <Text style={{ fontSize: 22, color: '#fff' }}>{rec ? '■' : '🎙'}</Text>
              </Pressable>
            </View>
            {!answer ? (
              <>
                <View style={{ flexDirection: 'row' }}>
                  <Btn title="Check" onPress={checkTyped} disabled={rec || hearing} />
                </View>
                <Pressable
                  onPress={() => {
                    if (rec) stopMic(false);
                    setShown(makeQuestion(w, words, ['word']).choices!);
                  }}
                  style={{ alignSelf: 'center', padding: 6 }}
                >
                  <Text style={{ color: c.muted, fontWeight: '600', fontSize: 14 }}>Show choices</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : q.kind === 'type' ? (
          <View style={{ gap: 10, marginTop: 18 }}>
            <TextInput
              value={answer ? answer.typed : typed}
              onChangeText={setTyped}
              editable={!answer}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={checkTyped}
              placeholder={han ? 'e.g. 周末 or zhoumo' : 'Type the word (accents optional)'}
              placeholderTextColor={c.faint}
              style={[styles.typeInput, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
            />
            {!answer ? (
              <View style={{ flexDirection: 'row' }}>
                <Btn title="Check" onPress={checkTyped} />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 9, marginTop: 18 }}>
            {(shown || q.choices!).map((ch, k) => {
              const right = ch.id === w.id;
              const picked = answer?.pick === ch.id;
              const state = !answer ? '' : right ? 'ok' : picked ? 'bad' : 'dim';
              return (
                <Pressable
                  key={ch.id}
                  disabled={!!answer}
                  onPress={() => answerWith(right, { pick: ch.id })}
                  style={[
                    styles.qopt,
                    { borderColor: c.line, backgroundColor: c.surface },
                    state === 'ok' && { borderColor: '#5BC48A', backgroundColor: c.okSoft },
                    state === 'bad' && { borderColor: c.rec, backgroundColor: c.badSoft },
                    state === 'dim' && { opacity: 0.45 },
                  ]}
                >
                  <View
                    style={[
                      styles.k,
                      { backgroundColor: c.surface2 },
                      state === 'ok' && { backgroundColor: '#5BC48A' },
                      state === 'bad' && { backgroundColor: c.rec },
                    ]}
                  >
                    <Text style={{ fontSize: 12, color: state === 'ok' ? '#0c2a1a' : state === 'bad' ? '#fff' : c.muted }}>
                      {state === 'ok' ? '✓' : state === 'bad' ? '✕' : k + 1}
                    </Text>
                  </View>
                  <Text style={[{ flex: 1, fontSize: 16, fontWeight: '700', color: c.ink }, q.kind !== 'meaning' && ch.lang === 'zh' && { fontFamily: HAN_FONT, fontSize: 20 }]}>
                    {q.kind === 'meaning' ? ch.meaning : ch.word}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

      </ScrollView>
        {answer ? (
          <View style={[styles.feed, { backgroundColor: c.surface }, answer.ok ? { backgroundColor: c.okSoft, borderColor: '#5BC48A' } : { backgroundColor: c.badSoft, borderColor: c.rec }]}>
            <Text style={{ fontWeight: '800', fontSize: 17, color: answer.ok ? c.ok : c.rec }}>
              {answer.ok ? 'Correct!' : 'Not quite'}
              {answer.heard ? <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted }}>  You said “{answer.heard}”</Text> : null}
            </Text>
            <Text style={{ color: c.ink, fontSize: 15 }}>
              <Text style={[{ fontWeight: '800', fontSize: 17 }, han && { fontFamily: HAN_FONT, fontSize: 19 }]}>{w.word}</Text>
              {han && w.pinyin ? <Text style={{ color: c.muted }}> {w.pinyin}</Text> : null} · {w.meaning}
            </Text>
            {w.example ? (
              <>
                <Text style={[{ color: c.ink, fontSize: 15 }, han && { fontFamily: HAN_FONT, fontSize: 17 }]}>{w.example.text}</Text>
                <Text style={{ color: c.muted, fontSize: 14 }}>{w.example.translation}</Text>
              </>
            ) : null}
            {review ? <Ladder w={words.find((x) => x.id === w.id) || w} onDark /> : null}
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <Btn title={i + 1 < count ? 'Next' : 'See results'} onPress={next} />
            </View>
          </View>
        ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  qtop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  qx: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  qbar: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  qcard: { marginTop: 10, borderRadius: 22, borderBottomLeftRadius: 6, paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center' },
  big: { color: '#fff', fontSize: 40, fontWeight: '800', textAlign: 'center' },
  spk: { position: 'absolute', right: 12, top: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  qopt: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  k: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  typeInput: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 19, fontWeight: '700' },
  // the answer is pinned to the bottom, so the question and choices never move
  feed: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 2,
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 18,
    gap: 4,
    elevation: 12,
  },
  ring: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ringDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
  rstats: { flexDirection: 'row', gap: 8, marginTop: 18 },
  rstat: { flex: 1, borderRadius: 14, padding: 10, alignItems: 'center' },
  rv: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
});

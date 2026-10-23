import * as Clipboard from 'expo-clipboard';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { FlatList, PanResponder, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { liveTranscribe, lookupWord, options, wordFamily } from '../api';
import { Btn, Label, NotAWord, Pinyin, Segmented, Sheet, sheetStyles, TextBtn, Working } from '../components';
import { speakWord } from '../speech';
import { deaccent, formatDate, HAN_FONT, useColors } from '../theme';
import { caseFor, DEFAULT_TEST_SETUP, FamilyForm, themeOf, LANGS, learningLang, LookupEntry, Settings, TestKind, TestSetup, Word, WORD_EXAMPLE, wordId, wordLangOf, wordLangs } from '../types';
import { cleanWord } from '../words';
import { ExampleBox } from './SessionScreen';
import { dueIn, dueWords, LADDER, nextReview, reviewStreak, srsOf, whenText } from '../review';

type Props = {
  settings: Settings;
  words: Word[];
  testSetup: TestSetup;
  onTestSetup: (s: TestSetup) => void;
  onStartTest: () => void;
  onReview: () => void; // today's due words
  onListen?: () => void; // example sentences read aloud
  onSaveWord: (w: Word) => void;
  onUpdateWord?: (w: Word) => void; // change a word in place (keeps its place in the list)
  onDeleteWord: (id: string) => void;
  toast: (msg: string) => void;
};

export const TEST_KINDS: { id: TestKind; title: string; hint: string }[] = [
  { id: 'meaning', title: 'Word → meaning', hint: 'See the word, pick what it means' },
  { id: 'word', title: 'Meaning → word', hint: 'See the meaning, pick the word' },
  { id: 'gap', title: 'Fill the gap', hint: 'Pick the missing word in an example sentence' },
  { id: 'type', title: 'Type it', hint: 'Type the word yourself (pinyin is fine for Chinese)' },
];

export function testPool(words: Word[], group: string, theme: string = 'any'): Word[] {
  let pool = group !== 'all' ? words.filter((w) => w.lang === group) : words;
  if (theme === 'daily' || theme === 'technical') pool = pool.filter((w) => themeOf(w) === theme);
  return pool;
}

/** How far up the review ladder a word is, and when it's due next. */
export function Ladder({ w, onDark }: { w: Word; onDark?: boolean }) {
  const c = useColors();
  const st = srsOf(w);
  const d = dueIn(w);
  const due = d <= 0;
  const n = due ? Math.max(1, st.step) : st.step;
  return (
    <View style={styles.lad}>
      {LADDER.map((_, i) => (
        <View key={i} style={[styles.ladStep, { backgroundColor: i < n ? (due ? c.yellow : '#5BC48A') : onDark ? 'rgba(255,255,255,0.18)' : c.line }]} />
      ))}
      <Text style={{ fontSize: 12, marginLeft: 8, color: due ? c.yellowText : onDark ? c.muted : c.faint, fontWeight: due ? '700' : '400' }}>
        {due ? 'due today' : `next review ${whenText(d)}`}
      </Text>
    </View>
  );
}

export default function WordsScreen(p: Props) {
  const { settings, words } = p;
  const c = useColors();
  const [filter, setFilter] = useState(() => learningLang(settings)); // opens on your main learning language
  const [colloqOnly, setColloqOnly] = useState(false);
  const isColloq = (w: Word) => w.register === 'colloquial';
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [setup, setSetup] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  // Word family: swipe a saved Indonesian / Malay word to see its other forms
  const [famView, setFamView] = useState<Record<string, number>>({});
  const [famLoading, setFamLoading] = useState<string | null>(null);
  const savedIndex = (w: Word) => Math.max(0, (w.family?.forms || []).findIndex((f) => f.word === w.word.toLowerCase()));
  async function famStep(w: Word, dir: number, jump?: number) {
    if (famLoading) return;
    let fam = w.family;
    if (!fam?.forms?.length) {
      setFamLoading(w.id);
      try {
        fam = await wordFamily(settings, w.word, w.lang, w.meaning);
        (p.onUpdateWord || p.onSaveWord)({ ...w, family: fam });
      } catch (e: any) {
        p.toast(String(e?.message ?? e));
        setFamLoading(null);
        return;
      }
      setFamLoading(null);
    }
    const n = fam.forms.length;
    const saved = Math.max(0, fam.forms.findIndex((f) => f.word === w.word.toLowerCase()));
    setFamView((v) => ({ ...v, [w.id]: jump != null ? jump : ((v[w.id] ?? saved) + dir + n) % n }));
  }
  function addForm(w: Word, f: FamilyForm) {
    p.onSaveWord({
      id: wordId(w.lang, f.word),
      word: caseFor(f.word, f.part_of_speech),
      lang: w.lang,
      pinyin: '',
      root: w.family && w.family.base !== f.word ? w.family.base : '',
      part_of_speech: f.part_of_speech || '',
      meaning: f.meaning,
      in_context: '',
      notes: '',
      example: f.example || null,
      sentence: '',
      sessionId: '',
      sessionTitle: `Family of ${w.word}`,
      createdAt: Date.now(),
      family: w.family,
    });
    p.toast(`${f.word} added to your words`);
  }

  const have = wordLangs([], words); // languages you have words in
  const f = filter !== 'all' && !have.some(([code]) => code === filter) ? 'all' : filter;
  const q = search.trim().toLowerCase();
  const list = words.filter(
    (w) =>
      (f === 'all' || w.lang === f) &&
      (!colloqOnly || f !== 'id' || isColloq(w)) &&
      (!q || [w.word, w.pinyin, w.meaning, w.root].join(' ').toLowerCase().includes(q) || deaccent(w.pinyin || '').includes(deaccent(q))),
  );

  const due = dueWords(words).length;
  const streak = reviewStreak();

  function openTest() {
    if (words.length < 4) {
      p.toast(words.length ? `Save ${4 - words.length} more words to start a test` : 'Save some words first');
      return;
    }
    setSetup(true);
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        extraData={[famView, famLoading, words, settings.pinyin]}
        keyExtractor={(w) => w.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 6, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={due ? p.onReview : openTest}
                disabled={!words.length}
                style={[styles.testBtn, { backgroundColor: c.yellow }, !words.length && { opacity: 0.55 }]}
                accessibilityRole="button"
              >
                <View style={styles.testIc}>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: c.yellowInk }}>{words.length && !due ? '✓' : '↻'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: c.yellowInk }}>{words.length && !due ? 'All caught up' : 'Review'}</Text>
                  <Text style={{ fontWeight: '700', fontSize: 12.5, color: c.yellowInk, opacity: 0.75 }}>
                    {!words.length ? 'Save some words first' : due ? `${due} ${due === 1 ? 'word' : 'words'} due today` : `Next review ${nextReview(words)}`}
                  </Text>
                </View>
                <Text style={{ fontSize: 22, color: c.yellowInk }}>›</Text>
              </Pressable>
              <Pressable onPress={() => setAdding(true)} style={[styles.addBtn, { backgroundColor: c.accent }]} accessibilityRole="button">
                <Text style={{ fontSize: 20 }}>🎙</Text>
                <Text style={{ color: c.accentInk, fontWeight: '800', fontSize: 11.5 }}>Add word</Text>
              </Pressable>
            </View>
            {words.length ? (
              <View style={styles.wsub}>
                {streak ? <Text style={{ fontSize: 13, fontWeight: '700', color: c.muted }}>🔥 {streak}-day streak</Text> : null}
                <View style={{ flex: 1 }} />
                <TextBtn title="Practice test ›" color={c.accent} bold onPress={openTest} />
              </View>
            ) : null}
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search your words"
              placeholderTextColor={c.faint}
              style={[styles.search, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
            />
            <View style={styles.filter}>
              {[['all', 'All'] as [string, string], ...(have.length > 1 || f !== 'all' ? have : [])].map(([code, label]) => (
                <Pressable
                  key={code}
                  onPress={() => {
                    setFilter(code);
                    setColloqOnly(false);
                  }}
                  style={[styles.chip, { borderColor: c.line }, f === code && { backgroundColor: c.accent, borderColor: c.accent }]}
                >
                  <Text style={{ fontSize: 13, color: f === code ? c.accentInk : c.muted, fontWeight: f === code ? '800' : '600' }}>{label}</Text>
                </Pressable>
              ))}
              {f === 'id' ? (
                // Colloquial: only once Indonesian is picked
                <Pressable
                  onPress={() => setColloqOnly((v) => !v)}
                  style={[styles.chip, { borderColor: c.line }, colloqOnly && { backgroundColor: c.yellow, borderColor: c.yellow }]}
                >
                  <Text style={{ fontSize: 13, color: colloqOnly ? c.yellowInk : c.muted, fontWeight: colloqOnly ? '800' : '600' }}>Colloquial</Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              {list.length ? (
                <Pressable
                  style={[styles.chip, { borderColor: c.line }]}
                  onPress={async () => {
                    const text = list
                      .map((w) => `${w.word}${w.pinyin ? ` (${w.pinyin})` : ''} — ${w.meaning}${w.example ? `\n  ${w.example.text}\n  ${w.example.translation}` : ''}`)
                      .join('\n');
                    await Clipboard.setStringAsync(text);
                    p.toast('Copied');
                  }}
                >
                  <Text style={{ fontSize: 13, color: c.muted, fontWeight: '600' }}>Copy list</Text>
                </Pressable>
              ) : null}
            </View>
            {words.length ? (
              <Text style={{ fontSize: 13, color: c.muted, fontWeight: '600' }}>
                {list.length} of {words.length} {words.length === 1 ? 'word' : 'words'}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: c.muted, fontSize: 15, paddingVertical: 18 }}>
            {words.length ? 'No words match.' : 'No saved words yet. Tap Add word to type or say one, or tap a word in any recording.'}
          </Text>
        }
        renderItem={({ item: w }) => {
          const han = w.lang === 'zh';
          const famOk = w.lang === 'id' || w.lang === 'ms';
          const fam = famOk && w.family?.forms?.length ? w.family : null;
          const saved = savedIndex(w);
          const idx = fam && famView[w.id] != null ? famView[w.id] : saved;
          const other = fam && idx !== saved ? fam.forms[idx] : null; // another form, not the saved word
          const onSwipe = famOk ? (dir: number) => famStep(w, dir) : undefined;
          const famRow = famOk ? (
            <View style={styles.famRow}>
              {fam ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {fam.forms.map((f, j) => (
                    <Pressable key={f.word} onPress={() => famStep(w, 0, j)} hitSlop={4} style={styles.dotHit} accessibilityLabel={f.word}>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: j === idx ? c.accent : j === saved ? c.yellow : c.line },
                          j === idx && { width: 16 },
                        ]}
                      />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Text style={{ fontSize: 11.5, color: c.faint }}>
                {famLoading === w.id ? 'Loading word family…' : `‹ swipe for ${fam?.base || w.root || w.word} family ›`}
              </Text>
            </View>
          ) : null;
          if (other) {
            const have = words.some((x) => x.id === wordId(w.lang, other.word));
            return (
              <FamSwipe onSwipe={onSwipe} style={[styles.card, { borderBottomColor: c.line, backgroundColor: c.accentSoft + '55' }]}>
                <View style={styles.top}>
                  <Pressable onPress={() => speakWord({ ...w, word: other.word }, settings.script)} style={[styles.spk, { backgroundColor: c.surface2 }]} hitSlop={6}>
                    <Text style={{ fontSize: 13 }}>🔊</Text>
                  </Pressable>
                  <View style={styles.wmain}>
                    <Text style={{ fontSize: 22, color: c.ink, flexShrink: 1 }}>{other.word}</Text>
                    {other.part_of_speech ? <Text style={[sheetStyles(c).pos, { marginTop: 0, alignSelf: 'center' }]}>{other.part_of_speech}</Text> : null}
                  </View>
                  {have ? (
                    <Text style={{ color: c.muted, fontWeight: '700', fontSize: 13 }}>✓ In your words</Text>
                  ) : (
                    <Pressable onPress={() => addForm(w, other)} style={[styles.famAdd, { backgroundColor: c.accent }]}>
                      <Text style={{ color: c.accentInk, fontWeight: '700', fontSize: 13 }}>＋ Add</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={{ color: c.ink, fontSize: 16 }}>
                  {other.meaning}
                  {fam!.base && fam!.base !== other.word ? <Text style={{ color: c.muted, fontSize: 13 }}> · base word {fam!.base}</Text> : null}
                </Text>
                {other.example ? (
                  <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }}>
                    {other.example.text}
                    {'\n'}
                    {other.example.translation}
                  </Text>
                ) : null}
                {famRow}
                <Text style={{ fontSize: 12, color: c.faint }}>
                  Same family as <Text style={{ fontWeight: '700', color: c.muted }}>{w.word}</Text>
                  {have ? '' : ' · not in your words'}
                </Text>
              </FamSwipe>
            );
          }
          return (
            <FamSwipe onSwipe={onSwipe} style={[styles.card, { borderBottomColor: c.line }]}>
              <View style={styles.top}>
                <Pressable
                  onPress={() => speakWord(w, settings.script)}
                  style={[styles.spk, { backgroundColor: c.surface2 }]}
                  accessibilityLabel={`Hear ${w.word}`}
                  hitSlop={6}
                >
                  <Text style={{ fontSize: 13 }}>🔊</Text>
                </Pressable>
                {/* the word, pinyin and tags wrap among themselves, so Edit stays on the first line */}
                <View style={styles.wmain}>
                  <Text style={[{ fontSize: 22, color: c.ink, flexShrink: 1 }, han && { fontFamily: HAN_FONT, fontWeight: '600' }]}>{w.word}</Text>
                  {settings.pinyin && w.pinyin ? <Pinyin value={w.pinyin} /> : null}
                  {w.part_of_speech ? <Text style={[sheetStyles(c).pos, { marginTop: 0, alignSelf: 'center' }]}>{w.part_of_speech}</Text> : null}
                  {isColloq(w) ? (
                    <Text style={[sheetStyles(c).pos, { marginTop: 0, alignSelf: 'center', color: c.yellowText, backgroundColor: c.yellowSoft }]}>colloquial</Text>
                  ) : null}
                </View>
                <TextBtn title="Edit" color={c.accent} bold onPress={() => setEditingWord(w)} />
              </View>
              <Text style={{ color: c.ink, fontSize: 16 }}>
                {w.meaning}
                {isColloq(w) && w.standard ? <Text style={{ color: c.muted, fontSize: 13 }}> · standard: {w.standard}</Text> : null}
                {w.root && w.root.toLowerCase() !== w.word.toLowerCase() ? <Text style={{ color: c.muted, fontSize: 13 }}> · base word {w.root}</Text> : null}
              </Text>
              {w.example ? (
                <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }}>
                  <Text style={han ? { fontFamily: HAN_FONT } : undefined}>{w.example.text}</Text>
                  {'\n'}
                  {w.example.translation}
                </Text>
              ) : null}
              {famRow}
              <Ladder w={w} />
              <View style={styles.src}>
                <Text style={{ fontSize: 12, color: c.faint, flex: 1 }} numberOfLines={1}>
                  {w.sessionTitle ? `From “${w.sessionTitle}” · ` : ''}
                  {formatDate(w.createdAt)}
                </Text>
                {confirm === w.id ? (
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <TextBtn
                      title="Delete"
                      color={c.rec}
                      bold
                      onPress={() => {
                        p.onDeleteWord(w.id);
                        setConfirm(null);
                        p.toast('Deleted');
                      }}
                    />
                    <TextBtn title="Keep" onPress={() => setConfirm(null)} />
                  </View>
                ) : (
                  <TextBtn title="Delete" onPress={() => setConfirm(w.id)} />
                )}
              </View>
            </FamSwipe>
          );
        }}
      />

      {adding ? <AddWordSheet {...p} onClose={() => setAdding(false)} /> : null}
      {editingWord ? (
        <EditWordSheet
          word={editingWord}
          onClose={() => setEditingWord(null)}
          onSave={(w) => {
            if (w.id !== editingWord.id) p.onDeleteWord(editingWord.id);
            p.onSaveWord(w);
            setEditingWord(null);
            p.toast('Word updated');
          }}
        />
      ) : null}
      {setup ? (
        <TestSetupSheet
          words={words}
          setup={p.testSetup}
          onChange={p.onTestSetup}
          onClose={() => setSetup(false)}
          onStart={() => {
            setSetup(false);
            p.onStartTest();
          }}
          onListen={
            p.onListen
              ? () => {
                  setSetup(false);
                  p.onListen!();
                }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

// ---------- add a word by typing or speaking ----------
export type AddPreset = { lang: string; text: string; source: string; known: string };
export function AddWordSheet({
  settings,
  words,
  onSaveWord,
  toast,
  onClose,
  preset,
}: Pick<Props, 'settings' | 'words' | 'onSaveWord' | 'toast'> & { onClose: () => void; preset?: AddPreset }) {
  const c = useColors();
  const ss = sheetStyles(c);
  const langs = wordLangs(settings.langs, words);
  const codes = langs.map(([code]) => code);
  const main = learningLang(settings);
  const [lang, setLang] = useState(preset?.lang || (codes.includes(main) ? main : codes[0] || 'zh'));
  const [text, setText] = useState(preset?.text || '');
  const [fromEn, setFromEn] = useState(!preset); // typing or saying an English word (on to start with)
  // a word bank term opens already looked up, written around the bank's meaning
  useEffect(() => {
    if (preset?.text) doLookup(preset.text);
  }, []);
  // An English word with several meanings ("track"): pick which. senses[0] is the one looked up first.
  const [senses, setSenses] = useState<NonNullable<LookupEntry['senses']>>([]);
  const [sense, setSense] = useState('');
  const first = useRef<LookupEntry | null>(null);
  const req = useRef(0); // the latest lookup: answers to older ones (e.g. for a word you've since changed) are ignored
  function reset() {
    req.current++;
    setEntry(null);
    setSenses([]);
    setSense('');
    first.current = null;
    setLoading(false);
    setError('');
  }
  const [entry, setEntry] = useState<LookupEntry | null>(null);
  const [meaning, setMeaning] = useState('');
  const [loading, setLoading] = useState<string | false>(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.isRecording) recorder.stop().catch(() => {});
    },
    [],
  );

  const han = lang === 'zh';
  const saved = !!entry && words.some((w) => w.id === wordId(lang, entry.word));

  async function doLookup(raw = text, which = '') {
    const word = cleanWord(raw);
    if (!word) return;
    setText(word);
    setError('');
    setEntry(null);
    setSense(which);
    if (!which) {
      setSenses([]);
      first.current = null;
    }
    setLoading(which ? `Looking up “${word}” as in ${which}…` : 'Looking it up…');
    const id = ++req.current;
    try {
      const e = await lookupWord(settings, word, fromEn ? '' : word, lang, fromEn, which, preset && word === preset.text ? preset.known : '');
      if (!alive.current || id !== req.current) return;
      setEntry(e);
      setMeaning(e.meaning);
      if (!which) setSenses(fromEn && e.senses && e.senses.length > 1 ? e.senses : []);
    } catch (e: any) {
      if (alive.current && id === req.current) setError(String(e?.message ?? e));
    }
    if (alive.current && id === req.current) setLoading(false);
  }

  async function startMic() {
    setError('');
    setEntry(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone access is off. Allow it for ChatTalk, or type the word instead.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      timer.current = setTimeout(() => stopMic(true), 6000);
    } catch (e: any) {
      setError(`Couldn’t use the microphone: ${String(e?.message ?? e)}`);
    }
  }

  async function stopMic(send: boolean) {
    if (timer.current) clearTimeout(timer.current);
    setRecording(false);
    try {
      await recorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (!send || !recorder.uri || !alive.current) return;
    setLoading('Listening back…');
    try {
      const r = await liveTranscribe(settings, recorder.uri, options(settings, fromEn ? 'en' : lang, fromEn ? lang : 'en'), 0, false);
      const heard = cleanWord(r.segments.map((x) => x.text).join(' '));
      if (!alive.current) return;
      if (!heard) {
        setLoading(false);
        setError('Didn’t catch that. Try again a little louder, or type the word.');
        return;
      }
      setText(heard);
      await doLookup(heard);
    } catch (e: any) {
      if (alive.current) {
        setLoading(false);
        setError(String(e?.message ?? e));
      }
    }
  }

  function save() {
    if (!entry) return;
    const existing = words.find((w) => w.id === wordId(lang, entry.word));
    onSaveWord({
      ...(existing || {}),
      id: wordId(lang, entry.word),
      word: caseFor(entry.word, entry.part_of_speech),
      lang,
      pinyin: entry.pinyin || '',
      root: caseFor(entry.root, entry.part_of_speech),
      part_of_speech: entry.part_of_speech || '',
      meaning: meaning.trim() || entry.meaning,
      in_context: '',
      notes: entry.notes || '',
      example: entry.example || null,
      register: entry.register || '',
      standard: entry.standard || '',
      sentence: existing?.sentence || '',
      sessionId: existing?.sessionId || '',
      sessionTitle: existing?.sessionTitle || preset?.source || 'Added by you',
      createdAt: existing?.createdAt || Date.now(),
    });
    toast(existing ? 'Word updated' : 'Added to your words');
    onClose();
  }

  return (
    <Sheet visible onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={ss.h2}>Add a word</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: fromEn ? c.accent : c.muted, fontWeight: '700', fontSize: 14 }}>English</Text>
          <Switch
            value={fromEn}
            onValueChange={(v) => {
              setFromEn(v);
              setText('');
              reset();
            }}
            trackColor={{ true: c.accent }}
            accessibilityLabel="Type in English"
          />
        </View>
      </View>
      <View style={styles.wrap}>
        {langs.map(([code, label]) => (
          <Pressable
            key={code}
            onPress={() => {
              setLang(code);
              reset();
            }}
            style={[styles.chip, { borderColor: c.line }, lang === code && { backgroundColor: c.accent, borderColor: c.accent }]}
          >
            <Text style={{ fontSize: 14, color: lang === code ? c.accentInk : c.muted, fontWeight: lang === code ? '800' : '600' }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (entry || senses.length || loading) reset(); // a new word: drop the old answer and its meanings
          }}
          onSubmitEditing={() => doLookup()}
          returnKeyType="search"
          autoCapitalize="none"
          autoFocus
          placeholder={fromEn ? 'Type or say an English word, e.g. weekend' : `Type or say a word${WORD_EXAMPLE[lang] ? `, e.g. ${WORD_EXAMPLE[lang]}` : ''}`}
          placeholderTextColor={c.faint}
          style={[styles.addInput, { borderColor: c.line, backgroundColor: c.bg, color: c.ink }]}
        />
        <Pressable
          onPress={() => (recording ? stopMic(true) : startMic())}
          style={[styles.mic, { backgroundColor: c.rec }]}
          accessibilityLabel={recording ? 'Stop listening' : 'Say the word'}
        >
          <Text style={{ color: '#fff', fontSize: recording ? 18 : 22 }}>{recording ? '■' : '🎙'}</Text>
        </Pressable>
      </View>
      {!entry && !loading && !recording ? <Btn title="Look it up" disabled={!text.trim()} onPress={() => doLookup()} /> : null}
      {recording ? (
        <Text style={{ color: c.muted, textAlign: 'center', fontWeight: '600' }}>Listening… say the word, then tap the microphone to stop.</Text>
      ) : loading ? (
        <Working text={loading} />
      ) : error ? (
        <Text style={ss.notice}>{error}</Text>
      ) : entry && entry.exists === false ? (
        <NotAWord
          word={entry.word}
          language={lang === 'zh' ? 'Chinese' : LANGS[lang] || lang}
          suggestions={entry.suggestions}
          han={han}
          onPick={(w) => {
            setFromEn(false);
            setText(w);
            doLookup(w);
          }}
        />
      ) : entry ? (
        <>
          {fromEn ? (
            <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }}>
              “{text}” in {lang === 'zh' ? 'Chinese' : LANGS[lang] || lang}
              {senses.length > 1 ? ' has more than one meaning. Which one?' : ''}
            </Text>
          ) : null}
          {fromEn && senses.length > 1 ? (
            <View style={{ gap: 6 }}>
              {senses.map((x, i) => {
                const on = (sense || senses[0].sense) === x.sense;
                return (
                  <Pressable
                    key={x.sense}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      if (on) return;
                      if (i === 0 && first.current) {
                        setSense('');
                        setEntry(first.current);
                        setMeaning(first.current.meaning);
                        return;
                      }
                      if (!first.current) first.current = entry; // keep the first answer, so going back to it is instant
                      doLookup(text, x.sense);
                    }}
                    style={[styles.sense, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accentSoft : c.surface }]}
                  >
                    <Text style={{ flex: 1, color: c.ink, fontWeight: '600', fontSize: 14 }}>{x.sense}</Text>
                    <Text style={[{ color: on ? c.accent : c.muted, fontWeight: on ? '700' : '500', fontSize: 14 }, han && { fontFamily: HAN_FONT }]}>{x.word}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View>
            <Text style={[{ fontSize: 32, color: c.ink }, han && { fontFamily: HAN_FONT, fontWeight: '600' }]}>{entry.word}</Text>
            {han && settings.pinyin && entry.pinyin ? <Pinyin value={entry.pinyin} size={16} /> : null}
            {entry.part_of_speech ? <Text style={ss.pos}>{entry.part_of_speech}</Text> : null}
          </View>
          <Text style={ss.k}>Meaning · check and edit before adding</Text>
          <TextInput
            value={meaning}
            onChangeText={setMeaning}
            multiline
            style={[styles.meaning, { borderColor: c.line, backgroundColor: c.bg, color: c.ink }]}
          />
          {entry.root && entry.root.toLowerCase() !== entry.word.toLowerCase() ? (
            <View>
              <Text style={ss.k}>Base word</Text>
              <Text style={ss.p}>{entry.root}</Text>
            </View>
          ) : null}
          {entry.notes ? (
            <View>
              <Text style={ss.k}>Note</Text>
              <Text style={ss.p}>{entry.notes}</Text>
            </View>
          ) : null}
          <ExampleBox ex={entry.example} han={han} pinyin={settings.pinyin} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn title={saved ? 'Update my word' : 'Add to my words'} onPress={save} />
            <Btn title="Cancel" kind="secondary" onPress={onClose} />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

// ---------- edit a saved word ----------
function EditWordSheet({ word: w, onClose, onSave }: { word: Word; onClose: () => void; onSave: (w: Word) => void }) {
  const c = useColors();
  const ss = sheetStyles(c);
  const han = w.lang === 'zh';
  const [word, setWord] = useState(w.word);
  const [pinyin, setPinyin] = useState(w.pinyin || '');
  const [meaning, setMeaning] = useState(w.meaning);
  const [exText, setExText] = useState(w.example?.text || '');
  const [exTr, setExTr] = useState(w.example?.translation || '');
  const [theme, setTheme] = useState<'daily' | 'technical'>(themeOf(w));
  const field = [styles.meaning, { borderColor: c.line, backgroundColor: c.bg, color: c.ink, minHeight: 0 }];
  return (
    <Sheet visible onClose={onClose}>
      <Text style={ss.h2}>Edit word</Text>
      <Text style={ss.k}>Word</Text>
      <TextInput value={word} onChangeText={setWord} autoCapitalize="none" style={[field, han && { fontFamily: HAN_FONT }]} />
      {han ? (
        <>
          <Text style={ss.k}>Pinyin</Text>
          <TextInput value={pinyin} onChangeText={setPinyin} autoCapitalize="none" style={field} />
        </>
      ) : null}
      <Text style={ss.k}>Meaning</Text>
      <TextInput value={meaning} onChangeText={setMeaning} multiline style={[field, { minHeight: 64 }]} />
      <Text style={ss.k}>Example sentence</Text>
      <TextInput
        value={exText}
        onChangeText={setExText}
        multiline
        placeholder="A sentence using the word"
        placeholderTextColor={c.faint}
        style={[field, { minHeight: 64 }, han && { fontFamily: HAN_FONT }]}
      />
      <Text style={ss.k}>Example in English</Text>
      <TextInput
        value={exTr}
        onChangeText={setExTr}
        multiline
        placeholder="What the sentence means"
        placeholderTextColor={c.faint}
        style={[field, { minHeight: 64 }]}
      />
      <Text style={ss.k}>Theme</Text>
      <Segmented
        value={theme}
        onChange={(v) => setTheme(v)}
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'technical', label: 'Technical' },
        ]}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn
          title="Save"
          disabled={!word.trim()}
          onPress={() =>
            onSave({
              ...w,
              id: wordId(w.lang, word.trim()),
              word: caseFor(word.trim(), w.part_of_speech),
              pinyin: pinyin.trim(),
              meaning: meaning.trim() || w.meaning,
              theme,
              example: exText.trim()
                ? {
                    ...(w.example || {}),
                    text: exText.trim(),
                    translation: exTr.trim(),
                    pinyin: exText.trim() === w.example?.text ? w.example?.pinyin : null,
                  }
                : null,
            })
          }
        />
        <Btn title="Cancel" kind="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

// ---------- test setup ----------
function TestSetupSheet({
  words,
  setup,
  onChange,
  onClose,
  onStart,
  onListen,
}: {
  words: Word[];
  setup: TestSetup;
  onChange: (s: TestSetup) => void;
  onClose: () => void;
  onStart: () => void;
  onListen?: () => void;
}) {
  const c = useColors();
  const ss = sheetStyles(c);
  const groups: [string, string][] = [['all', 'All'], ...wordLangs([], words)];
  const t = groups.some(([g]) => g === setup.group) ? setup : { ...setup, group: 'all' };
  const theme = t.theme || 'any';
  const pool = testPool(words, t.group, theme);
  const counts = [5, 10, 20].filter((n) => n < pool.length);
  const n = Math.min(pool.length, counts.includes(t.count) ? t.count : pool.length);
  const set = (patch: Partial<TestSetup>) => onChange({ ...DEFAULT_TEST_SETUP, ...t, ...patch });
  return (
    <Sheet visible onClose={onClose}>
      <Text style={ss.h2}>New test</Text>
      <Label style={{ marginTop: 6, marginBottom: 0 }}>Words</Label>
      <View style={styles.wrap}>
        {groups.map(([g, label]) => (
          <Pressable
            key={g}
            onPress={() => set({ group: g })}
            style={[styles.chip, { borderColor: c.line }, t.group === g && { backgroundColor: c.accent, borderColor: c.accent }]}
          >
            <Text style={{ fontSize: 14, color: t.group === g ? c.accentInk : c.muted, fontWeight: t.group === g ? '800' : '600' }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Label style={{ marginBottom: 0 }}>Theme</Label>
      <Segmented
        value={theme}
        onChange={(v) => set({ theme: v as TestSetup['theme'] })}
        options={[
          { value: 'any', label: 'Any' },
          { value: 'daily', label: `Daily ${testPool(words, t.group, 'daily').length}` },
          { value: 'technical', label: `Technical ${testPool(words, t.group, 'technical').length}` },
        ]}
      />
      <Label style={{ marginBottom: 0 }}>Questions</Label>
      <Segmented
        value={String(counts.includes(t.count) ? t.count : 0)}
        onChange={(v) => set({ count: +v })}
        options={[...counts.map((x) => ({ value: String(x), label: String(x) })), { value: '0', label: `All ${pool.length}` }]}
      />
      <Label style={{ marginBottom: 0 }}>Question types</Label>
      <View style={{ gap: 8 }}>
        {TEST_KINDS.map((k) => {
          const on = t.kinds.includes(k.id);
          return (
            <Pressable
              key={k.id}
              onPress={() => set({ kinds: on ? t.kinds.filter((x) => x !== k.id) : [...t.kinds, k.id] })}
              style={[styles.kind, { backgroundColor: c.bg, borderColor: on ? c.accent : 'transparent' }]}
            >
              <View style={[styles.box, { borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : 'transparent' }]}>
                {on ? <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontWeight: '800', fontSize: 15 }}>{k.title}</Text>
                <Text style={{ color: c.muted, fontSize: 12.5 }}>{k.hint}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Btn title={`Start ${n} questions`} disabled={!t.kinds.length || !pool.length} onPress={onStart} />
      </View>
      {onListen ? (
        <View style={{ flexDirection: 'row' }}>
          <Btn title="🎧 Listen to sentences" kind="secondary" disabled={!pool.some((w) => w.example?.text)} onPress={onListen} style={{ flex: 1 }} />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  testBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 },
  testIc: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  addBtn: { borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', gap: 1 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  filter: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wmain: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  spk: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  src: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wsub: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -2 },
  lad: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ladStep: { width: 14, height: 5, borderRadius: 3 },
  addInput: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700' },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  meaning: { minHeight: 64, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, fontWeight: '700', textAlignVertical: 'top' },
  famRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  dotHit: { paddingHorizontal: 2, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  famAdd: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  sense: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  kind: { flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});

// A word card you can swipe left or right (Indonesian / Malay: to move through the word family).
// Without onSwipe it's a plain card. Vertical scrolling of the list still works.
function FamSwipe({ onSwipe, style, children }: { onSwipe?: (dir: number) => void; style: any; children: React.ReactNode }) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => !!cb.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 45) cb.current?.(g.dx < 0 ? 1 : -1);
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  return (
    <View {...(onSwipe ? pan.panHandlers : {})} style={style}>
      {children}
    </View>
  );
}

import * as Clipboard from 'expo-clipboard';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { liveTranscribe, lookupWord, options } from '../api';
import { Btn, Label, Pinyin, Segmented, Sheet, sheetStyles, TextBtn, Working } from '../components';
import { speakWord } from '../speech';
import { deaccent, formatDate, HAN_FONT, useColors } from '../theme';
import { caseFor, DEFAULT_TEST_SETUP, LANGS, LookupEntry, Settings, TestKind, TestSetup, Word, WORD_EXAMPLE, wordId, wordLangOf, wordLangs } from '../types';
import { cleanWord } from '../words';
import { ExampleBox } from './SessionScreen';

type Props = {
  settings: Settings;
  words: Word[];
  testSetup: TestSetup;
  onTestSetup: (s: TestSetup) => void;
  onStartTest: () => void;
  onSaveWord: (w: Word) => void;
  onDeleteWord: (id: string) => void;
  toast: (msg: string) => void;
};

export const TEST_KINDS: { id: TestKind; title: string; hint: string }[] = [
  { id: 'meaning', title: 'Word → meaning', hint: 'See the word, pick what it means' },
  { id: 'word', title: 'Meaning → word', hint: 'See the meaning, pick the word' },
  { id: 'gap', title: 'Fill the gap', hint: 'Pick the missing word in an example sentence' },
  { id: 'type', title: 'Type it', hint: 'Type the word yourself (pinyin is fine for Chinese)' },
];

export function testPool(words: Word[], group: string): Word[] {
  if (group === 'weak') {
    return words
      .slice()
      .sort((a, b) => (a.level || 0) - (b.level || 0) || (b.wrong || 0) - (a.wrong || 0) || (a.lastTested || 0) - (b.lastTested || 0));
  }
  if (group !== 'all') return words.filter((w) => w.lang === group);
  return words;
}

export default function WordsScreen(p: Props) {
  const { settings, words } = p;
  const c = useColors();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [setup, setSetup] = useState(false);

  const have = wordLangs([], words); // languages you have words in
  const f = filter !== 'all' && !have.some(([code]) => code === filter) ? 'all' : filter;
  const q = search.trim().toLowerCase();
  const list = words.filter(
    (w) =>
      (f === 'all' || w.lang === f) &&
      (!q || [w.word, w.pinyin, w.meaning, w.root].join(' ').toLowerCase().includes(q) || deaccent(w.pinyin || '').includes(deaccent(q))),
  );

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
        keyExtractor={(w) => w.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 6, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={openTest}
                disabled={!words.length}
                style={[styles.testBtn, { backgroundColor: c.yellow }, !words.length && { opacity: 0.55 }]}
                accessibilityRole="button"
              >
                <View style={styles.testIc}>
                  <Text style={{ fontSize: 18, color: c.yellowInk }}>✎</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: c.yellowInk }}>Start a test</Text>
                  <Text style={{ fontWeight: '700', fontSize: 12.5, color: c.yellowInk, opacity: 0.75 }}>
                    {words.length >= 4 ? `${words.length} words saved` : words.length ? `Save ${4 - words.length} more to test yourself` : 'Save some words first'}
                  </Text>
                </View>
                <Text style={{ fontSize: 22, color: c.yellowInk }}>›</Text>
              </Pressable>
              <Pressable onPress={() => setAdding(true)} style={[styles.addBtn, { backgroundColor: c.accent }]} accessibilityRole="button">
                <Text style={{ fontSize: 20 }}>🎙</Text>
                <Text style={{ color: c.accentInk, fontWeight: '800', fontSize: 11.5 }}>Add word</Text>
              </Pressable>
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search your words"
              placeholderTextColor={c.faint}
              style={[styles.search, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
            />
            <View style={styles.filter}>
              {[['all', 'All'] as [string, string], ...(have.length > 1 ? have : [])].map(([code, label]) => (
                <Pressable
                  key={code}
                  onPress={() => setFilter(code)}
                  style={[styles.chip, { borderColor: c.line }, f === code && { backgroundColor: c.accent, borderColor: c.accent }]}
                >
                  <Text style={{ fontSize: 13, color: f === code ? c.accentInk : c.muted, fontWeight: f === code ? '800' : '600' }}>{label}</Text>
                </Pressable>
              ))}
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
          return (
            <View style={[styles.card, { borderBottomColor: c.line }]}>
              <View style={styles.top}>
                <Pressable
                  onPress={() => speakWord(w, settings.script)}
                  style={[styles.spk, { backgroundColor: c.surface2 }]}
                  accessibilityLabel={`Hear ${w.word}`}
                  hitSlop={6}
                >
                  <Text style={{ fontSize: 13 }}>🔊</Text>
                </Pressable>
                <Text style={[{ fontSize: 22, color: c.ink }, han && { fontFamily: HAN_FONT, fontWeight: '600' }]}>{w.word}</Text>
                {settings.pinyin && w.pinyin ? <Pinyin value={w.pinyin} /> : null}
                {w.part_of_speech ? <Text style={[sheetStyles(c).pos, { marginTop: 0 }]}>{w.part_of_speech}</Text> : null}
                <View style={{ flex: 1 }} />
                <View style={styles.lvl} accessibilityLabel={`Known: ${w.level || 0} of 3`}>
                  {[0, 1, 2].map((k) => (
                    <View key={k} style={[styles.dot, { backgroundColor: (w.level || 0) > k ? '#5BC48A' : c.line }]} />
                  ))}
                </View>
              </View>
              <Text style={{ color: c.ink, fontSize: 16 }}>
                {w.meaning}
                {w.root && w.root.toLowerCase() !== w.word.toLowerCase() ? <Text style={{ color: c.muted, fontSize: 13 }}> · base word {w.root}</Text> : null}
              </Text>
              {w.example ? (
                <Text style={{ color: c.muted, fontSize: 14, marginTop: 2 }}>
                  <Text style={han ? { fontFamily: HAN_FONT } : undefined}>{w.example.text}</Text>
                  {'\n'}
                  {w.example.translation}
                </Text>
              ) : null}
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
            </View>
          );
        }}
      />

      {adding ? <AddWordSheet {...p} onClose={() => setAdding(false)} /> : null}
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
        />
      ) : null}
    </View>
  );
}

// ---------- add a word by typing or speaking ----------
function AddWordSheet({ settings, words, onSaveWord, toast, onClose }: Props & { onClose: () => void }) {
  const c = useColors();
  const ss = sheetStyles(c);
  const langs = wordLangs(settings.langs, words);
  const codes = langs.map(([code]) => code);
  const src = wordLangOf(settings.source);
  const [lang, setLang] = useState(codes.includes(src) ? src : codes.includes(settings.target) ? settings.target : codes[0] || 'zh');
  const [text, setText] = useState('');
  const [fromEn, setFromEn] = useState(false); // typing or saying an English word
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

  async function doLookup(raw = text) {
    const word = cleanWord(raw);
    if (!word) return;
    setText(word);
    setError('');
    setEntry(null);
    setLoading('Looking it up…');
    try {
      const e = await lookupWord(settings, word, fromEn ? '' : word, lang, fromEn);
      if (!alive.current) return;
      setEntry(e);
      setMeaning(e.meaning);
    } catch (e: any) {
      if (alive.current) setError(String(e?.message ?? e));
    }
    if (alive.current) setLoading(false);
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
      sentence: existing?.sentence || '',
      sessionId: existing?.sessionId || '',
      sessionTitle: existing?.sessionTitle || 'Added by you',
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
              setEntry(null);
              setError('');
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
              setEntry(null);
              setError('');
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
            if (entry) setEntry(null);
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
      ) : entry ? (
        <>
          {fromEn ? (
            <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }}>
              “{text}” in {lang === 'zh' ? 'Chinese' : LANGS[lang] || lang}
            </Text>
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

// ---------- test setup ----------
function TestSetupSheet({
  words,
  setup,
  onChange,
  onClose,
  onStart,
}: {
  words: Word[];
  setup: TestSetup;
  onChange: (s: TestSetup) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const c = useColors();
  const ss = sheetStyles(c);
  const groups: [string, string][] = [['all', 'All'], ...wordLangs([], words), ['weak', 'Weakest']];
  const t = groups.some(([g]) => g === setup.group) ? setup : { ...setup, group: 'all' };
  const pool = testPool(words, t.group);
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
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  spk: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  lvl: { flexDirection: 'row', gap: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  src: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addInput: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700' },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  meaning: { minHeight: 64, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 17, fontWeight: '700', textAlignVertical: 'top' },
  kind: { flexDirection: 'row', gap: 12, alignItems: 'center', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});

import * as Clipboard from 'expo-clipboard';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Svg, { Path, Rect } from 'react-native-svg';

import { liveTranslate, lookupWord, options, redoLine, retranslate } from '../api';
import { Btn, NotAWord, Pinyin, Sheet, sheetStyles, TextBtn, WordText, Working } from '../components';
import { formatDate, formatTime, HAN_FONT, useColors } from '../theme';
import { caseFor, hasHan, isChinese, LANGS, LookupEntry, LOOKUP_LANGS, Segment, Session, Settings, Word, wordId, wordLangOf } from '../types';
import { joinTokens, mainsFor, pickByChar, picksFor, pickTokens, rangeFor, tapPick, Token, tokenize } from '../words';

type Props = {
  session: Session;
  settings: Settings;
  words: Word[];
  onBack: () => void;
  onNew: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onUpdateSegment: (segmentId: number, changes: Partial<Segment>) => void;
  onTranslated: () => void; // every line has a translation again
  onSaveWord: (w: Word) => void;
  onRemoveWord: (id: string) => void;
  toast: (msg: string, action?: { label: string; run: () => void }) => void;
};

type Lookup = {
  i: number;
  side: 's' | 't';
  lang: string;
  text: string;
  tokens: Token[]; // words in the transcript
  picks: Token[]; // characters (or words) shown in the card
  a: number; // selection, as indexes into picks
  b: number;
  query: string;
  entry: LookupEntry | null;
  error: string;
  loading: boolean;
};

const cache = new Map<string, LookupEntry>();

export default function SessionScreen(p: Props) {
  const { session, settings } = p;
  const c = useColors();
  const ss = sheetStyles(c);
  const player = useAudioPlayer(session.audioUri || null);
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState<Segment | null>(null);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [redoing, setRedoing] = useState<number | null>(null); // id of the line being listened to again
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const lookupRef = useRef<Lookup | null>(null);
  lookupRef.current = lookup;

  const srcOf = (seg: Segment) => seg.lang || session.source;
  const tgtOf = (seg: Segment) => seg.target || session.target;
  const tokens = useMemo(
    () =>
      session.segments.map((seg) => ({
        s: tokenize(seg.text, srcOf(seg)),
        t: tokenize(seg.translation || '', tgtOf(seg)),
      })),
    [session.segments],
  );

  // Stop at the end of the line being replayed
  useEffect(() => {
    if (playing && (status.currentTime >= playing.end || status.didJustFinish)) {
      player.pause();
      setPlaying(null);
    }
  }, [status.currentTime, status.didJustFinish, playing]);

  async function playSegment(seg: Segment) {
    if (playing?.id === seg.id) {
      player.pause();
      setPlaying(null);
      return;
    }
    if (!session.audioUri) {
      Alert.alert('Can’t play this line', 'This recording was restored from a backup, which doesn’t include audio.');
      return;
    }
    try {
      await player.seekTo(seg.start);
      player.play();
      setPlaying(seg);
    } catch {
      Alert.alert('Can’t play this line', 'The audio for this recording is no longer on your phone.');
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const idx = session.segments.findIndex((s) => s.id === editing.id);
      const context = session.segments.slice(Math.max(0, idx - 6), idx);
      const r = await retranslate(settings, draft, context, srcOf(editing), tgtOf(editing), session.script);
      p.onUpdateSegment(editing.id, { text: r.text, pinyin: r.pinyin, translation: r.translation, translation_pinyin: r.translation_pinyin });
      setEditing(null);
    } catch (e: any) {
      Alert.alert('Couldn’t re-translate', String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  // Redo one line: the server listens to its audio again (fixing likely mishearings) and translates it again
  async function redo(seg: Segment) {
    if (redoing !== null) return;
    setRedoing(seg.id);
    try {
      const idx = session.segments.findIndex((s) => s.id === seg.id);
      const r = await redoLine(settings, session, seg, session.segments.slice(Math.max(0, idx - 6), idx), session.segments.slice(idx + 1, idx + 3));
      const before = { text: seg.text, pinyin: seg.pinyin, translation: seg.translation, translation_pinyin: seg.translation_pinyin };
      p.onUpdateSegment(seg.id, { text: r.text, pinyin: r.pinyin, translation: r.translation, translation_pinyin: r.translation_pinyin });
      p.toast('Line redone', { label: 'Undo', run: () => p.onUpdateSegment(seg.id, before) });
    } catch (e: any) {
      Alert.alert('Couldn’t redo this line', String(e?.message ?? e));
    } finally {
      setRedoing(null);
    }
  }

  const transcript = () => session.segments.map((s) => `[${formatTime(s.start)}] ${s.text}\n${s.translation}`).join('\n\n');

  // ---------- word lookup ----------
  function openLookup(i: number, side: 's' | 't', k: number) {
    const seg = session.segments[i];
    const lang = side === 's' ? srcOf(seg) : tgtOf(seg);
    const text = side === 's' ? seg.text : seg.translation;
    const tk = side === 's' ? tokens[i].s : tokens[i].t;
    const picks = pickTokens(text, lang);
    const [a, b] = picksFor(tk, k, picks);
    fetchLookup({ i, side, lang, text, tokens: tk, picks, a, b, query: '', entry: null, error: '', loading: true });
  }

  async function fetchLookup(base: Lookup, override?: string) {
    const word = override || joinTokens(base.picks, base.a, base.b);
    const next = { ...base, query: word, entry: null, error: '', loading: true };
    setLookup(next);
    const key = `${base.lang}|${settings.script}|${word}|${base.text}`;
    try {
      let entry = cache.get(key);
      if (!entry) {
        entry = await lookupWord(settings, word, base.text, base.lang);
        cache.set(key, entry);
      }
      const cur = lookupRef.current;
      if (!cur || cur.query !== word) return; // a newer lookup replaced this one
      // The dictionary may return the whole word (e.g. 周末 for 周): grow the highlight to match
      const [a, b] = override ? [cur.a, cur.b] : rangeFor(cur.picks, cur.a, cur.b, entry.word);
      setLookup({ ...cur, a, b, entry, loading: false });
    } catch (e: any) {
      const cur = lookupRef.current;
      if (cur && cur.query === word) setLookup({ ...cur, error: String(e?.message ?? e), loading: false });
    }
  }

  // Tap characters in the card to look up more or fewer; wait for a pause in tapping before looking up
  const pickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pickTimer.current) clearTimeout(pickTimer.current);
  }, []);
  function pick(k: number) {
    if (!lookup) return;
    const [a, b] = tapPick(lookup.picks, lookup.a, lookup.b, k);
    if (a === lookup.a && b === lookup.b) return;
    const next = { ...lookup, a, b, query: joinTokens(lookup.picks, a, b), entry: null, error: '', loading: true };
    setLookup(next);
    if (pickTimer.current) clearTimeout(pickTimer.current);
    pickTimer.current = setTimeout(() => {
      const cur = lookupRef.current;
      if (cur && cur.a === a && cur.b === b && cur.i === next.i && cur.side === next.side) fetchLookup(cur);
    }, 700);
  }

  function saveWord() {
    const e = lookup?.entry;
    if (!lookup || !e) return;
    p.onSaveWord({
      id: wordId(lookup.lang, e.word),
      word: caseFor(e.word, e.part_of_speech),
      lang: wordLangOf(lookup.lang),
      pinyin: e.pinyin || '',
      root: caseFor(e.root, e.part_of_speech),
      part_of_speech: e.part_of_speech || '',
      meaning: e.meaning,
      in_context: e.in_context || '',
      notes: e.notes || '',
      example: e.example || null,
      register: e.register || '',
      standard: e.standard || '',
      sentence: lookup.text,
      sessionId: session.id,
      sessionTitle: session.title,
      createdAt: Date.now(),
    });
    p.toast('Added to your words');
  }

  const lineCount = session.segments.length;
  const e = lookup?.entry;
  const lookHan = lookup ? isChinese(lookup.lang) : false;
  const saved = !!(lookup && e && p.words.some((w) => w.id === wordId(lookup.lang, e.word)));

  // Translate the lines that have no translation yet (after a translation failure), batch by batch
  const [translatingMissing, setTranslatingMissing] = useState(false);
  const missing = session.segments.filter((seg) => !seg.translation);
  async function translateMissing() {
    if (translatingMissing) return;
    setTranslatingMissing(true);
    try {
      const segs = session.segments;
      const done = new Map<number, string>(segs.filter((x) => x.translation).map((x) => [x.id, x.translation]));
      // consecutive lines going the same way (conversations switch direction), at most 20 per request
      const groups: { dir: string; items: number[] }[] = [];
      segs.forEach((seg, i) => {
        if (seg.translation) return;
        const dir = `${srcOf(seg)}>${tgtOf(seg)}`;
        const g = groups[groups.length - 1];
        if (g && g.dir === dir && g.items.length < 20 && g.items[g.items.length - 1] === i - 1) g.items.push(i);
        else groups.push({ dir, items: [i] });
      });
      for (const g of groups) {
        const first = segs[g.items[0]];
        const context = segs
          .slice(Math.max(0, g.items[0] - 6), g.items[0])
          .filter((x) => done.get(x.id))
          .map((x) => ({ text: x.text, translation: done.get(x.id) || '' }));
        const r = await liveTranslate(
          settings,
          g.items.map((i) => ({ id: segs[i].id, text: segs[i].text })),
          context,
          options(settings, srcOf(first), tgtOf(first), session.script),
        );
        for (const t of r.translations) {
          if (!t.translation) continue;
          done.set(t.id, t.translation);
          p.onUpdateSegment(t.id, { translation: t.translation, translation_pinyin: t.translation_pinyin });
        }
      }
      if (segs.every((x) => done.get(x.id))) {
        p.onTranslated();
        p.toast('Translated');
      }
    } catch (e: any) {
      Alert.alert('Couldn’t translate', String(e?.message ?? e));
    } finally {
      setTranslatingMissing(false);
    }
  }

  // Share the recording's audio: save it to Files or Drive, send it on WhatsApp...
  async function shareAudio() {
    try {
      if (!session.audioUri) throw new Error('This recording has no audio on this phone.');
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this phone.');
      await Sharing.shareAsync(session.audioUri, { dialogTitle: session.title });
    } catch (e: any) {
      Alert.alert('Couldn’t share the audio', String(e?.message ?? e));
    }
  }

  // Save the transcript and translation as a text file, through the share menu (Files, Drive, WhatsApp...)
  async function shareText() {
    try {
      const name = (session.title || 'recording').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'recording';
      const file = new File(Paths.cache, `${name}.txt`);
      file.create({ overwrite: true });
      file.write(`${session.title}\n${formatDate(session.createdAt)}\n\n${transcript()}\n`);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: session.title });
    } catch (e: any) {
      Alert.alert('Couldn’t save the translation', String(e?.message ?? e));
    }
  }

  // Rename, saving and Delete live in the ••• menu
  const deleteRow = undefined;
  const [menu, setMenu] = useState(false);
  const menuItems: { id: string; label: string; icon: keyof typeof MENU_ICONS; danger?: boolean; run: () => void }[] = [
    ...(session.status === 'done'
      ? [{ id: 'rename', label: 'Rename', icon: 'rename' as const, run: () => { setTitleDraft(session.title); setRenaming(true); } }]
      : []),
    ...(session.audioUri ? [{ id: 'audio', label: 'Save audio', icon: 'audio' as const, run: shareAudio }] : []),
    ...(session.status === 'done' && lineCount ? [{ id: 'text', label: 'Save translation', icon: 'text' as const, run: shareText }] : []),
    { id: 'del', label: 'Delete recording', icon: 'del' as const, danger: true, run: () => setConfirmDelete(true) },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <TextBtn title="‹ History" onPress={p.onBack} />
        {session.status !== 'processing' ? (
          <Pressable onPress={() => setMenu(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="More options" style={{ paddingVertical: 6, paddingLeft: 12 }}>
            <Text style={{ color: c.faint, fontSize: 15, letterSpacing: 2, fontWeight: '800' }}>•••</Text>
          </Pressable>
        ) : null}
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <View style={{ gap: 2 }}>
          {menuItems.map((it) => (
            <View key={it.id}>
              {it.danger && menuItems.length > 1 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: 6 }} /> : null}
              <Pressable
                onPress={() => {
                  setMenu(false);
                  it.run();
                }}
                style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
              >
                <View style={[styles.menuIc, { backgroundColor: c.surface2 }]}>
                  <MenuIcon name={it.icon} color={it.danger ? c.rec : c.accent} />
                </View>
                <Text style={{ fontSize: 16, fontWeight: '600', color: it.danger ? c.rec : c.ink }}>{it.label}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </Sheet>

      <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <Text style={ss.h2}>Delete this recording?</Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>{session.title}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn
            title="Delete"
            style={{ backgroundColor: c.rec }}
            onPress={() => {
              setConfirmDelete(false);
              p.onDelete();
            }}
          />
          <Btn title="Keep" kind="secondary" onPress={() => setConfirmDelete(false)} />
        </View>
      </Sheet>

      <Pressable
        style={{ paddingHorizontal: 16 }}
        onPress={() => {
          if (session.status !== 'done') return;
          setTitleDraft(session.title);
          setRenaming(true);
        }}
      >
        <Text style={[styles.title, { color: c.ink }, hasHan(session.title) && { fontFamily: HAN_FONT }]}>
          {session.status === 'processing' ? 'Translating…' : session.status === 'error' ? 'Translation failed' : session.title}
        </Text>
        <Text style={[styles.meta, { color: c.muted }]}>
          {session.mode === 'conversation'
            ? `Conversation · ${LANGS[session.source]} ⇄ ${LANGS[session.target]}`
            : `${LANGS[session.source]} → ${LANGS[session.target]}`}
          {session.mode === 'subtitles' ? ' · Live' : ''} · {formatDate(session.createdAt)}
          {session.duration ? ` · ${formatTime(session.duration)}` : ''}
          {session.status === 'done' ? ` · ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}` : ''}
        </Text>
      </Pressable>

      {session.status === 'processing' ? (
        <Working text={'Transcribing with Whisper, then translating.\nLonger recordings take a minute or two.'} />
      ) : session.status === 'error' ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Working text={session.error || 'Something went wrong.'} />
          <Btn title="Try again" kind="small" onPress={p.onRetry} />
          {deleteRow}
        </View>
      ) : (
        <FlatList
          data={session.segments}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          ListHeaderComponent={
            !lineCount ? (
              <Text style={[styles.tip, { color: c.muted, fontSize: 15 }]}>No speech was found in this recording.</Text>
            ) : session.untranslated && missing.length ? (
              <View style={[styles.trFail, { backgroundColor: c.warnSoft }]}>
                <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>
                  <Text style={{ fontWeight: '800' }}>Translation failed.</Text> The transcript is saved.{' '}
                  {session.untranslated.replace(/^Translation failed:\s*/, '')}
                </Text>
                <Btn
                  title={translatingMissing ? 'Translating…' : `Translate ${missing.length} ${missing.length === 1 ? 'line' : 'lines'}`}
                  kind="small"
                  disabled={translatingMissing}
                  onPress={translateMissing}
                />
              </View>
            ) : undefined
          }
          ListFooterComponent={deleteRow}
          renderItem={({ item, index }) => {
            const active = playing?.id === item.id;
            const src = srcOf(item);
            const tgt = tgtOf(item);
            const sel = (side: 's' | 't'): [number, number] | null =>
              lookup && lookup.i === index && lookup.side === side ? mainsFor(lookup.tokens, lookup.picks, lookup.a, lookup.b) : null;
            return (
              <View style={[styles.line, { borderBottomColor: c.line }, active && { backgroundColor: c.accentSoft, borderBottomColor: 'transparent', borderRadius: 16 }]}>
                <Pressable onPress={() => playSegment(item)} style={styles.time} accessibilityLabel={`Play line ${index + 1}`}>
                  <View style={[styles.play, { backgroundColor: active ? c.accent : c.surface2 }]}>
                    <Text style={{ color: active ? '#fff' : c.accent, fontSize: 11 }}>{active ? '■' : '▶'}</Text>
                  </View>
                  <Text style={{ color: c.faint, fontSize: 11, fontVariant: ['tabular-nums'] }}>{formatTime(item.start)}</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  {session.mode === 'conversation' ? <Text style={[styles.tag, { color: c.faint }]}>{LANGS[src]?.toUpperCase()}</Text> : null}
                  <WordText
                    tokens={tokens[index].s}
                    style={[isChinese(src) ? styles.han : styles.orig, { color: c.ink }]}
                    onWord={LOOKUP_LANGS.includes(src) ? (k) => openLookup(index, 's', k) : undefined}
                    sel={sel('s')}
                  />
                  {settings.pinyin && item.pinyin ? <Pinyin value={item.pinyin} /> : null}
                  {item.translation ? (
                    <WordText
                      tokens={tokens[index].t}
                      style={[styles.tr, { color: c.ink }, isChinese(tgt) && styles.trHan]}
                      onWord={LOOKUP_LANGS.includes(tgt) ? (k) => openLookup(index, 't', k) : undefined}
                      sel={sel('t')}
                    />
                  ) : (
                    <Text style={[styles.tr, { color: c.ink }]}>—</Text>
                  )}
                  {settings.pinyin && item.translation_pinyin ? <Pinyin value={item.translation_pinyin} /> : null}
                  <View style={{ alignSelf: 'flex-start', flexDirection: 'row', gap: 18 }}>
                    <TextBtn
                      title="Edit"
                      onPress={() => {
                        setDraft(item.text);
                        setEditing(item);
                      }}
                    />
                    <TextBtn title={redoing === item.id ? 'Listening again…' : '↻ Redo'} onPress={() => redo(item)} />
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {session.status === 'done' ? (
        <View style={styles.actions}>
          <Btn
            title="Copy"
            kind="secondary"
            onPress={async () => {
              await Clipboard.setStringAsync(transcript());
              p.toast('Copied');
            }}
          />
          <Btn title="New recording" onPress={p.onNew} />
        </View>
      ) : null}

      {/* word lookup */}
      <Sheet visible={!!lookup} onClose={() => setLookup(null)}>
        {lookup ? (
          <>
            <View style={styles.wcHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.wcWord, { color: c.ink }, lookHan && { fontFamily: HAN_FONT, fontWeight: '600' }]}>{e ? e.word : lookup.query}</Text>
                {lookHan && settings.pinyin && e?.pinyin ? <Pinyin value={e.pinyin} size={16} /> : null}
                {e?.part_of_speech ? <Text style={ss.pos}>{e.part_of_speech}</Text> : null}
              </View>
            </View>
            <View style={[styles.picker, { backgroundColor: c.bg }]}>
              <Text style={ss.k}>{pickByChar(lookup.lang) ? 'Tap characters to look up more or fewer' : 'Tap words to look up more or fewer'}</Text>
              <View style={styles.picks}>
                {lookup.picks.map((x, k) => {
                  if (!x.w) return x.t.trim() ? <Text key={k} style={[styles.pickPunct, { color: c.faint }]}>{x.t.trim()}</Text> : null;
                  const on = k >= lookup.a && k <= lookup.b;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => pick(k)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.pick, on && { backgroundColor: c.yellow }]}
                    >
                      <Text style={[{ fontSize: 20, color: on ? c.yellowInk : c.ink }, lookHan && { fontFamily: HAN_FONT, fontSize: 22 }]}>{x.t}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {lookup.loading ? (
              <Working text="Looking up…" />
            ) : lookup.error ? (
              <>
                <Text style={ss.notice}>{lookup.error}</Text>
                <Btn title="Try again" kind="small" onPress={() => fetchLookup(lookup, lookup.query)} />
              </>
            ) : e && e.exists === false ? (
              <>
                <NotAWord
                  word={e.word}
                  language={isChinese(lookup.lang) ? 'Chinese' : LANGS[lookup.lang] || lookup.lang}
                  suggestions={e.suggestions}
                  han={lookHan}
                  onPick={(w) => fetchLookup(lookup, w)}
                />
                <View style={{ flexDirection: 'row' }}>
                  <Btn title="Close" kind="secondary" onPress={() => setLookup(null)} />
                </View>
              </>
            ) : e ? (
              <>
                <Text style={{ fontSize: 18, fontWeight: '700', color: c.ink }}>{e.meaning}</Text>
                {e.in_context ? (
                  <View>
                    <Text style={ss.k}>In this sentence</Text>
                    <Text style={ss.p}>{e.in_context}</Text>
                  </View>
                ) : null}
                {e.root && e.root.toLowerCase() !== e.word.toLowerCase() ? (
                  <View>
                    <Text style={ss.k}>Base word</Text>
                    <Text style={[ss.p, { color: c.accent, textDecorationLine: 'underline' }]} onPress={() => fetchLookup(lookup, e.root)}>
                      {e.root}
                    </Text>
                  </View>
                ) : null}
                {e.notes ? (
                  <View>
                    <Text style={ss.k}>Note</Text>
                    <Text style={ss.p}>{e.notes}</Text>
                  </View>
                ) : null}
                <ExampleBox ex={e.example} han={lookHan} pinyin={settings.pinyin} />
                <View style={styles.wcActions}>
                  {saved ? (
                    <>
                      <Text style={{ color: c.accent, fontWeight: '800', fontSize: 15 }}>✓ In your words</Text>
                      <View style={{ flex: 1 }} />
                      <TextBtn
                        title="Remove"
                        color={c.rec}
                        onPress={() => {
                          p.onRemoveWord(wordId(lookup.lang, e.word));
                          p.toast('Removed');
                        }}
                      />
                    </>
                  ) : (
                    <Btn title="Add to my words" onPress={saveWord} />
                  )}
                  <Btn title="Close" kind="secondary" onPress={() => setLookup(null)} />
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>

      {/* fix a misheard line */}
      <Sheet visible={!!editing} onClose={() => setEditing(null)}>
        <Text style={ss.h2}>Fix what was said</Text>
        <Text style={{ color: c.muted, fontSize: 14 }}>Correct misheard words, then re-translate this line.</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          autoFocus
          style={[styles.input, { borderColor: c.accent, color: c.ink, backgroundColor: c.bg }, editing && isChinese(srcOf(editing)) && { fontFamily: HAN_FONT }]}
        />
        <View style={styles.wcActions}>
          <Btn title="Cancel" kind="secondary" onPress={() => setEditing(null)} />
          <Btn title="Re-translate" busy={saving} disabled={!draft.trim()} onPress={saveEdit} />
        </View>
      </Sheet>

      {/* rename */}
      <Sheet visible={renaming} onClose={() => setRenaming(false)}>
        <Text style={ss.h2}>Rename recording</Text>
        <TextInput
          value={titleDraft}
          onChangeText={setTitleDraft}
          autoFocus
          selectTextOnFocus
          style={[styles.input, { borderColor: c.accent, color: c.ink, backgroundColor: c.bg, minHeight: 0, fontSize: 18 }]}
        />
        <View style={styles.wcActions}>
          <Btn title="Cancel" kind="secondary" onPress={() => setRenaming(false)} />
          <Btn
            title="Save"
            disabled={!titleDraft.trim()}
            onPress={() => {
              p.onRename(titleDraft.trim());
              setRenaming(false);
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}

export function ExampleBox({ ex, han, pinyin }: { ex?: LookupEntry['example']; han: boolean; pinyin: boolean }) {
  const c = useColors();
  const ss = sheetStyles(c);
  if (!ex) return null;
  return (
    <View style={ss.ex}>
      <Text style={ss.k}>Example</Text>
      <Text style={[{ fontSize: 18, color: c.ink }, han && { fontFamily: HAN_FONT }]}>{ex.text}</Text>
      {pinyin && ex.pinyin ? <Pinyin value={ex.pinyin} /> : null}
      <Text style={{ color: c.muted, fontSize: 15, marginTop: 2 }}>{ex.translation}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', lineHeight: 29 },
  meta: { fontSize: 13, marginTop: 4, marginBottom: 10, fontWeight: '600' },
  tip: { fontSize: 12, marginBottom: 4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  menuIc: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  trFail: { borderRadius: 14, padding: 14, gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  line: { flexDirection: 'row', gap: 10, paddingVertical: 14, paddingHorizontal: 10, marginHorizontal: -10, borderBottomWidth: StyleSheet.hairlineWidth },
  time: { width: 46, alignItems: 'center', gap: 3, paddingTop: 2 },
  play: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tag: { fontSize: 11, letterSpacing: 1, fontWeight: '700', marginBottom: 2 },
  han: { fontFamily: HAN_FONT, fontSize: 22, lineHeight: 34 },
  orig: { fontSize: 21, lineHeight: 31 },
  tr: { fontSize: 17, lineHeight: 25, marginTop: 8 },
  trHan: { fontFamily: HAN_FONT, fontSize: 19, lineHeight: 29 },
  delRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 20 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  wcHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  wcWord: { fontSize: 32, lineHeight: 40 },
  picker: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  picks: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, columnGap: 2, alignItems: 'center' },
  pick: { borderRadius: 8, paddingHorizontal: 4, paddingVertical: 4, minWidth: 30, alignItems: 'center' },
  pickPunct: { fontSize: 20, paddingHorizontal: 1 },
  wcActions: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  input: { minHeight: 80, borderWidth: 1.5, borderRadius: 12, padding: 12, fontSize: 19, textAlignVertical: 'top' },
});

// Outline icons for the ••• menu, all drawn the same way so they match
const MENU_ICONS = {
  rename: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  audio: ['M4 15v-3a8 8 0 0 1 16 0v3'],
  text: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6M9 16h6'],
  del: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
};
function MenuIcon({ name, color }: { name: keyof typeof MENU_ICONS; color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {MENU_ICONS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
      {name === 'audio' ? (
        <>
          <Rect x={3} y={14} width={4} height={6} rx={1.5} />
          <Rect x={17} y={14} width={4} height={6} rx={1.5} />
        </>
      ) : null}
    </Svg>
  );
}

import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { retranslate } from '../api';
import { Pinyin } from '../components';
import { formatDate, formatTime, useColors } from '../theme';
import { isChinese, LANGS, Segment, Session, Settings, Source } from '../types';

type Props = {
  session: Session;
  settings: Settings;
  onBack: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onUpdateSegment: (segmentId: number, changes: Partial<Segment>) => void;
};

const HAN = /[㐀-鿿]/;

export default function SessionScreen({ session, settings, onBack, onRetry, onDelete, onRename, onUpdateSegment }: Props) {
  const c = useColors();
  const player = useAudioPlayer(session.audioUri);
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState<Segment | null>(null);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title);
  const srcHan = isChinese(session.source);
  const tgtHan = isChinese(session.target);

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
      const r = await retranslate(settings, session, draft, context);
      onUpdateSegment(editing.id, { text: r.text, pinyin: r.pinyin, translation: r.translation, translation_pinyin: r.translation_pinyin });
      setEditing(null);
    } catch (e: any) {
      Alert.alert('Couldn’t re-translate', String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function share() {
    const body = session.segments.map((s) => `[${formatTime(s.start)}] ${s.text}\n${s.translation}`).join('\n\n');
    Share.share({ title: session.title, message: `${session.title}\n${formatDate(session.createdAt)}\n\n${body}` });
  }

  function confirmDelete() {
    Alert.alert('Delete this recording?', session.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  }

  const lineCount = session.segments.length;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={[styles.link, { color: c.muted }]}>‹ Back</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          {session.status === 'done' && (
            <Pressable onPress={share} hitSlop={12}>
              <Text style={[styles.link, { color: c.muted }]}>Share</Text>
            </Pressable>
          )}
          <Pressable onPress={confirmDelete} hitSlop={12}>
            <Text style={[styles.link, { color: c.muted }]}>Delete</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        onPress={() => {
          if (session.status !== 'done') return;
          setTitleDraft(session.title);
          setRenaming(true);
        }}
      >
        <Text style={[styles.title, { color: c.ink }, HAN.test(session.title) && { fontFamily: 'serif' }]} numberOfLines={3}>
          {session.status === 'processing' ? 'Translating…' : session.status === 'error' ? 'Translation failed' : session.title}
        </Text>
      </Pressable>
      <Text style={[styles.meta, { color: c.muted }]}>
        {LANGS[session.source]} → {LANGS[session.target as Source]} · {formatDate(session.createdAt)}
        {session.duration ? ` · ${formatTime(session.duration)}` : ''}
        {session.status === 'done' ? ` · ${lineCount} ${lineCount === 1 ? 'line' : 'lines'}` : ''}
      </Text>

      {session.status === 'processing' && (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} size="large" />
          <Text style={[styles.centerText, { color: c.ink }]}>Transcribing and translating…</Text>
          <Text style={[styles.centerSub, { color: c.muted }]}>
            Longer recordings take a minute or two. If the server was asleep, the first one takes about a minute longer.
          </Text>
        </View>
      )}

      {session.status === 'error' && (
        <View style={styles.center}>
          <Text style={[styles.centerSub, { color: c.muted }]}>{session.error}</Text>
          <Pressable onPress={onRetry} style={[styles.button, { backgroundColor: c.accent }]}>
            <Text style={[styles.buttonText, { color: c.accentInk }]}>Try again</Text>
          </Pressable>
        </View>
      )}

      {session.status === 'done' && (
        <FlatList
          data={session.segments}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={<Text style={[styles.centerSub, { color: c.muted }]}>No speech was found in this recording.</Text>}
          ListHeaderComponent={
            lineCount ? (
              <Text style={[styles.tip, { color: c.faint }]}>
                Tap a line to replay it · long-press to fix a misheard line · tap the title to rename
              </Text>
            ) : undefined
          }
          renderItem={({ item }) => {
            const active = playing?.id === item.id;
            return (
              <Pressable
                onPress={() => playSegment(item)}
                onLongPress={() => {
                  setDraft(item.text);
                  setEditing(item);
                }}
                style={[styles.line, { borderBottomColor: c.line }, active && { backgroundColor: c.accentSoft, borderBottomColor: 'transparent' }]}
              >
                <Text style={[styles.time, { color: c.faint }]}>
                  {active ? '■ ' : '▶ '}
                  {formatTime(item.start)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={[srcHan ? styles.han : styles.orig, { color: c.ink }]} selectable>
                    {item.text}
                  </Text>
                  {settings.pinyin && srcHan ? <Pinyin value={item.pinyin} colors={c} /> : null}
                  <Text style={[styles.tr, { color: c.ink }, tgtHan && styles.trHan]} selectable>
                    {item.translation || '—'}
                  </Text>
                  {settings.pinyin && tgtHan ? <Pinyin value={item.translation_pinyin} colors={c} /> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={[styles.sheet, { backgroundColor: c.card }]}>
            <Text style={[styles.sheetTitle, { color: c.ink }]}>Fix what was said</Text>
            <Text style={[styles.centerSub, { color: c.muted, textAlign: 'left' }]}>Correct misheard words, then re-translate this line.</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              style={[styles.input, { borderColor: c.line, color: c.ink }, srcHan && { fontFamily: 'serif' }]}
            />
            <View style={styles.sheetActions}>
              <Pressable onPress={() => setEditing(null)} hitSlop={10}>
                <Text style={[styles.link, { color: c.muted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEdit}
                disabled={saving || !draft.trim()}
                style={[styles.button, { backgroundColor: c.accent, marginTop: 0 }, saving && { opacity: 0.6 }]}
              >
                {saving ? <ActivityIndicator color={c.accentInk} /> : <Text style={[styles.buttonText, { color: c.accentInk }]}>Re-translate</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={renaming} transparent animationType="slide" onRequestClose={() => setRenaming(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={[styles.sheet, { backgroundColor: c.card }]}>
            <Text style={[styles.sheetTitle, { color: c.ink }]}>Rename recording</Text>
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              autoFocus
              selectTextOnFocus
              style={[styles.input, { borderColor: c.line, color: c.ink, minHeight: 0, fontSize: 18 }]}
            />
            <View style={styles.sheetActions}>
              <Pressable onPress={() => setRenaming(false)} hitSlop={10}>
                <Text style={[styles.link, { color: c.muted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={!titleDraft.trim()}
                onPress={() => {
                  onRename(titleDraft.trim());
                  setRenaming(false);
                }}
                style={[styles.button, { backgroundColor: c.accent, marginTop: 0 }]}
              >
                <Text style={[styles.buttonText, { color: c.accentInk }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  link: { fontSize: 16 },
  title: { fontSize: 22, fontWeight: '600', lineHeight: 29 },
  meta: { fontSize: 13, marginTop: 4, marginBottom: 10 },
  tip: { fontSize: 12, marginBottom: 6 },
  center: { alignItems: 'center', paddingTop: 70, gap: 10, paddingHorizontal: 10 },
  centerText: { fontSize: 17 },
  centerSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: { paddingHorizontal: 22, paddingVertical: 11, borderRadius: 22, marginTop: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  line: { flexDirection: 'row', gap: 10, paddingVertical: 14, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  time: { width: 48, fontSize: 12, paddingTop: 6, fontVariant: ['tabular-nums'] },
  han: { fontFamily: 'serif', fontSize: 21, lineHeight: 31 },
  orig: { fontSize: 19, lineHeight: 27 },
  tr: { fontSize: 16, lineHeight: 23, marginTop: 6, opacity: 0.88 },
  trHan: { fontFamily: 'serif', fontSize: 18, lineHeight: 27 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '600' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, alignItems: 'center' },
  input: { minHeight: 90, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 19, textAlignVertical: 'top' },
});

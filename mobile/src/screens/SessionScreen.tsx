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
import { colors, formatDate, formatTime } from '../theme';
import { Segment, Session, Settings } from '../types';

type Props = {
  session: Session;
  settings: Settings;
  onBack: () => void;
  onRetry: () => void;
  onUpdateSegment: (segmentId: number, changes: Partial<Segment>) => void;
};

export default function SessionScreen({ session, settings, onBack, onRetry, onUpdateSegment }: Props) {
  const player = useAudioPlayer(session.audioUri);
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState<Segment | null>(null);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

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
    await player.seekTo(seg.start);
    player.play();
    setPlaying(seg);
  }

  function openEditor(seg: Segment) {
    setDraft(seg.zh);
    setEditing(seg);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const idx = session.segments.findIndex((s) => s.id === editing.id);
      const context = session.segments.slice(Math.max(0, idx - 6), idx);
      const result = await retranslate(settings, draft, context);
      onUpdateSegment(editing.id, { zh: result.zh, pinyin: result.pinyin, en: result.en });
      setEditing(null);
    } catch (e: any) {
      Alert.alert('Could not re-translate', String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function exportText() {
    const body = session.segments
      .map((s) => [`[${formatTime(s.start)}] ${s.zh}`, s.pinyin, s.en].filter(Boolean).join('\n'))
      .join('\n\n');
    Share.share({ title: session.title, message: `${session.title}\n${formatDate(session.createdAt)}\n\n${body}` });
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.link}>‹ Back</Text>
        </Pressable>
        {session.status === 'done' && (
          <Pressable onPress={exportText} hitSlop={12}>
            <Text style={styles.link}>Share</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {session.title}
      </Text>
      <Text style={styles.meta}>
        {formatDate(session.createdAt)} · {formatTime(session.duration)}
      </Text>

      {session.status === 'processing' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.seal} size="large" />
          <Text style={styles.centerText}>Transcribing and translating…</Text>
          <Text style={styles.centerSub}>Longer recordings take a minute or two.</Text>
        </View>
      )}

      {session.status === 'error' && (
        <View style={styles.center}>
          <Text style={[styles.centerText, { color: colors.seal }]}>Translation failed</Text>
          <Text style={styles.centerSub}>{session.error}</Text>
          <Pressable onPress={onRetry} style={styles.button}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {session.status === 'done' && (
        <FlatList
          data={session.segments}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={<Text style={styles.centerSub}>No speech was detected in this recording.</Text>}
          ListHeaderComponent={
            session.segments.length ? (
              <Text style={styles.tip}>Tap a line to replay it · long-press to correct the Chinese</Text>
            ) : undefined
          }
          renderItem={({ item }) => {
            const active = playing?.id === item.id;
            return (
              <Pressable
                onPress={() => playSegment(item)}
                onLongPress={() => openEditor(item)}
                style={[styles.line, active && styles.lineActive]}
              >
                <Text style={styles.time}>{formatTime(item.start)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zh} selectable>
                    {item.zh}
                  </Text>
                  {settings.pinyin && item.pinyin ? <Text style={styles.pinyin}>{item.pinyin}</Text> : null}
                  <Text style={styles.en} selectable>
                    {item.en || '—'}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Correct the Chinese</Text>
            <Text style={styles.centerSub}>Fix misheard words, then re-translate this line.</Text>
            <TextInput value={draft} onChangeText={setDraft} multiline autoFocus style={styles.input} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' }}>
              <Pressable onPress={() => setEditing(null)} hitSlop={10}>
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveEdit} disabled={saving || !draft.trim()} style={[styles.button, saving && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Re-translate</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  link: { fontSize: 16, color: colors.muted },
  title: { fontSize: 22, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 12 },
  tip: { fontSize: 12, color: colors.faint, marginBottom: 8 },
  center: { alignItems: 'center', paddingTop: 80, gap: 10 },
  centerText: { fontSize: 17, color: colors.ink },
  centerSub: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  button: { backgroundColor: colors.seal, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 22, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  line: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  lineActive: { backgroundColor: colors.sealSoft, borderBottomColor: 'transparent' },
  time: { width: 40, fontSize: 12, color: colors.faint, paddingTop: 5, fontVariant: ['tabular-nums'] },
  zh: { fontSize: 20, lineHeight: 30, color: colors.ink },
  pinyin: { fontSize: 13, color: colors.muted, marginTop: 2 },
  en: { fontSize: 16, lineHeight: 23, color: '#3D3730', marginTop: 6 },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: colors.card, padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: colors.ink },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    fontSize: 20,
    color: colors.ink,
    textAlignVertical: 'top',
  },
});

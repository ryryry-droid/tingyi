import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { loadBank, plain } from '../bank';
import { Pinyin, TextBtn } from '../components';
import { speakWord } from '../speech';
import { HAN_FONT, useColors } from '../theme';
import { BankTerm, Settings, Word, wordId } from '../types';
import { AddPreset, AddWordSheet } from './WordsScreen';

// The Singapore Mandarin word bank: its own list and test, kept apart from your words
type Props = {
  settings: Settings;
  words: Word[];
  onBack: () => void;
  onTest: (terms: BankTerm[]) => void;
  onSaveWord: (w: Word) => void;
  toast: (msg: string) => void;
};

export default function BankScreen({ settings, words, onBack, onTest, onSaveWord, toast }: Props) {
  const c = useColors();
  const [terms, setTerms] = useState<BankTerm[] | null>(null);
  const [letter, setLetter] = useState('all');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<AddPreset | null>(null);

  useEffect(() => {
    loadBank(settings).then(setTerms);
  }, []);

  const all = terms || [];
  const letters = useMemo(() => [...new Set(all.map((t) => plain(t.pinyin)[0]?.toUpperCase()).filter(Boolean))].sort(), [terms]);
  const q = plain(search.trim());
  const list = all.filter(
    (t) =>
      (letter === 'all' || plain(t.pinyin)[0]?.toUpperCase() === letter) &&
      (!q || t.word.includes(search.trim()) || plain(t.pinyin).replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) || plain(t.meaning).includes(q)),
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(t) => t.word}
        keyboardShouldPersistTaps="handled"
        extraData={[words, settings.pinyin]}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 4 }}>
            <View style={{ alignSelf: 'flex-start' }}>
              <TextBtn title="‹ Settings" onPress={onBack} />
            </View>
            <View>
              <Text style={{ color: c.ink, fontSize: 22, fontWeight: '800' }}>🇸🇬 Singapore Mandarin</Text>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>From the Singaporean Mandarin Database</Text>
            </View>
            <Pressable
              onPress={() => all.length && onTest(all)}
              style={[styles.test, { backgroundColor: c.yellow }]}
              accessibilityRole="button"
            >
              <Text style={{ fontWeight: '800', fontSize: 16, color: c.yellowInk }}>Start a test</Text>
              <Text style={{ fontWeight: '700', fontSize: 12.5, color: c.yellowInk, opacity: 0.7, flex: 1 }}>
                {terms ? `${Math.min(10, all.length)} questions from ${all.length} terms` : 'Loading…'}
              </Text>
              <Text style={{ fontSize: 22, color: c.yellowInk }}>›</Text>
            </Pressable>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search terms"
              placeholderTextColor={c.faint}
              style={[styles.search, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]}
            />
            <View style={styles.letters}>
              {['all', ...letters].map((l) => {
                const on = letter === l;
                return (
                  <Pressable key={l} onPress={() => setLetter(l)} style={[styles.letter, { backgroundColor: on ? c.badSoft : c.surface2 }]}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? c.rec : c.muted }}>{l === 'all' ? 'All' : l}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }}>
              {search.trim() || letter !== 'all' ? `${list.length} of ${all.length} terms` : `${all.length} terms`}
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={{ color: c.muted, paddingVertical: 18 }}>{terms ? 'No terms match.' : 'Loading…'}</Text>}
        renderItem={({ item: t }) => {
          const have = words.some((w) => w.id === wordId('zh', t.word));
          return (
            <View style={[styles.card, { borderBottomColor: c.line }]}>
              <View style={styles.top}>
                <Pressable onPress={() => speakWord({ word: t.word, lang: 'zh' }, settings.script)} style={[styles.spk, { backgroundColor: c.surface2 }]} hitSlop={6}>
                  <Text style={{ fontSize: 13 }}>🔊</Text>
                </Pressable>
                <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10 }}>
                  <Text style={{ fontSize: 22, color: c.ink, fontFamily: HAN_FONT, fontWeight: '600' }}>{t.word}</Text>
                  {settings.pinyin ? <Pinyin value={t.pinyin} /> : null}
                </View>
                {have ? (
                  <Text style={{ color: c.muted, fontWeight: '700', fontSize: 13 }}>✓ In my words</Text>
                ) : (
                  <TextBtn title="＋ My words" color={c.accent} bold onPress={() => setAdding({ lang: 'zh', text: t.word, source: 'SG Mandarin', known: t.meaning })} />
                )}
              </View>
              <Text style={{ color: c.ink, fontSize: 16 }}>{t.meaning}</Text>
            </View>
          );
        }}
      />
      {adding ? <AddWordSheet settings={settings} words={words} onSaveWord={onSaveWord} toast={toast} onClose={() => setAdding(null)} preset={adding} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  test: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, paddingVertical: 13, paddingHorizontal: 16 },
  search: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  letters: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  letter: { borderRadius: 999, minWidth: 30, paddingHorizontal: 9, paddingVertical: 4, alignItems: 'center' },
  card: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  spk: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});

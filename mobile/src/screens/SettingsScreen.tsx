import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { checkServer } from '../api';
import { LEVELS, levelOf, playCry, setSoundVolume } from '../sounds';
import { Label, Segmented } from '../components';
import { useColors } from '../theme';
import { CATALOG, distinctLangs, fixPair, LANGS, learningLang, learnLangs, Settings } from '../types';

type Props = {
  settings: Settings;
  onChange: (s: Settings) => void;
  toast: (msg: string) => void;
  buzzPreview: () => void;
  onBackup: () => void;
  onRestore: () => void;
};

export default function SettingsScreen({ settings: s, onChange, toast, buzzPreview, onBackup, onRestore }: Props) {
  const c = useColors();
  const [showCode, setShowCode] = useState(false);
  const [langsOpen, setLangsOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult({ ok: true, text: await checkServer(s) });
    } catch (e: any) {
      setTestResult({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setTesting(false);
    }
  }

  function toggleLang(code: string) {
    const on = s.langs.includes(code);
    const langs = on ? s.langs.filter((x) => x !== code) : [...s.langs, code];
    if (distinctLangs(langs) < 2) {
      toast('Keep at least two languages');
      return;
    }
    onChange({ ...s, langs, ...fixPair(langs, s.source, s.target) });
    toast(on ? `${LANGS[code]} removed` : `${LANGS[code]} added`);
  }

  const input = [styles.input, { backgroundColor: c.surface, borderColor: c.line, color: c.ink }];
  const hint = [styles.help, { color: c.muted }];

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Label>Languages</Label>
      <Pressable
        onPress={() => setLangsOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: langsOpen }}
        style={[styles.langSum, { borderColor: c.line, backgroundColor: c.surface }]}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: c.ink, fontSize: 15 }}>
          {(() => {
            const mine = CATALOG.filter(([code]) => s.langs.includes(code)).map(([, n]) => n);
            return mine.length > 3 ? `${mine.slice(0, 3).join(', ')} +${mine.length - 3}` : mine.join(', ');
          })()}
        </Text>
        <Text style={{ color: c.accent, fontWeight: '700', fontSize: 15 }}>{langsOpen ? 'Done' : 'Edit'}</Text>
      </Pressable>
      {langsOpen ? (
      <View style={[styles.langs, { marginTop: 10 }]}>
        {CATALOG.map(([code, , label]) => {
          const on = s.langs.includes(code);
          return (
            <Pressable
              key={code}
              onPress={() => toggleLang(code)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.lang, { borderColor: c.line, backgroundColor: c.surface }, on && { backgroundColor: c.accent, borderColor: c.accent }]}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: on ? c.accentInk : c.muted }}>
                {on ? '✓ ' : '＋ '}
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      ) : null}

      <Label style={styles.gap}>Main learning language</Label>
      <Segmented
        value={learningLang(s)}
        onChange={(v) => set('mainLang', v)}
        options={learnLangs(s.langs).map((code) => ({ value: code, label: code === 'zh' ? 'Chinese' : LANGS[code] }))}
      />

      <Label style={styles.gap}>Chinese characters</Label>
      <Segmented
        value={s.script}
        onChange={(v) => set('script', v)}
        options={[
          { value: 'simplified', label: 'Simplified 简体' },
          { value: 'traditional', label: 'Traditional 繁體' },
        ]}
      />

      <Label style={styles.gap}>Appearance</Label>
      <Segmented
        value={s.theme}
        onChange={(v) => set('theme', v)}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
      />

      <Label style={styles.gap}>Translation style</Label>
      <Segmented
        value={s.style}
        onChange={(v) => set('style', v)}
        options={[
          { value: 'natural', label: 'Natural' },
          { value: 'literal', label: 'Literal' },
        ]}
      />

      <View style={styles.switchRow}>
        <Text style={{ fontSize: 16, color: c.ink, fontWeight: '600', flex: 1 }}>Chatot slider</Text>
        <Text style={{ fontSize: 14, color: c.muted, fontWeight: '700' }}>{levelOf(s.volume).name}</Text>
      </View>
      <View style={styles.levels}>
        {LEVELS.map((l) => {
          const on = levelOf(s.volume).id === l.id;
          return (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                set('volume', l.volume);
                setSoundVolume(l.volume);
                playCry(); // hear it at that level
              }}
              style={[styles.level, { backgroundColor: on ? c.accentSoft : c.surface2, borderColor: on ? c.accent : 'transparent' }]}
            >
              <Image source={l.img} style={[styles.levelImg, l.id === 'off' && { opacity: 0.55 }]} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: on ? c.ink : c.muted }}>{l.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.switchRow}>
        <Text style={{ fontSize: 16, color: c.ink, fontWeight: '600', flex: 1 }}>Vibrate when a recording stops</Text>
        <Switch
          value={s.vibrate}
          onValueChange={(v) => {
            set('vibrate', v);
            if (v) buzzPreview();
          }}
          trackColor={{ true: c.accent }}
        />
      </View>

      <View style={styles.switchRow}>
        <Text style={{ fontSize: 16, color: c.ink, fontWeight: '600', flex: 1 }}>Show pinyin</Text>
        <Switch value={s.pinyin} onValueChange={(v) => set('pinyin', v)} trackColor={{ true: c.accent }} />
      </View>
      <Text style={hint}>
        Coloured by tone: <Text style={{ color: c.tones[1] }}>mā</Text> <Text style={{ color: c.tones[2] }}>má</Text>{' '}
        <Text style={{ color: c.tones[3] }}>mǎ</Text> <Text style={{ color: c.tones[4] }}>mà</Text> <Text style={{ color: c.tones[0] }}>ma</Text>
      </Text>

      <Label style={styles.gap}>Glossary</Label>
      <TextInput
        value={s.glossary}
        onChangeText={(v) => set('glossary', v)}
        multiline
        placeholder={'王小明 = Wang Xiaoming\nPak Budi = Mr Budi'}
        placeholderTextColor={c.faint}
        style={[input, { minHeight: 110, textAlignVertical: 'top' }]}
      />
      <Text style={hint}>One per line, in any of the languages. Helps names get heard correctly and translated consistently.</Text>

      <Label style={styles.gap}>Server address</Label>
      <TextInput
        value={s.serverUrl}
        onChangeText={(v) => set('serverUrl', v)}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://tingyi-xxxx.onrender.com"
        placeholderTextColor={c.faint}
        style={input}
      />
      <Text style={hint}>The link of your Render server, the same one you open in Chrome.</Text>

      <Label style={styles.gap}>Access code</Label>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          value={s.apiToken}
          onChangeText={(v) => set('apiToken', v)}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!showCode}
          placeholder="The API_TOKEN you set on Render"
          placeholderTextColor={c.faint}
          style={[input, { flex: 1 }]}
        />
        <Pressable onPress={() => setShowCode((v) => !v)} hitSlop={8}>
          <Text style={{ color: c.accent, fontSize: 14, fontWeight: '700' }}>{showCode ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
      <Text style={hint}>Keeps strangers from using your API credits. Stored only on this phone.</Text>
      <Pressable onPress={test} style={styles.testButton} disabled={testing}>
        {testing ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: c.accent, fontSize: 15, fontWeight: '700' }}>Test connection</Text>}
      </Pressable>
      {testResult && <Text style={[styles.help, { color: testResult.ok ? c.ok : c.rec }]}>{testResult.text}</Text>}

      <Label style={styles.gap}>Back up and restore</Label>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {([['Back up', onBackup], ['Restore', onRestore]] as const).map(([label, run]) => (
          <Pressable
            key={label}
            onPress={run}
            accessibilityRole="button"
            style={({ pressed }) => [styles.backupBtn, { backgroundColor: c.surface2, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={hint}>
        Back up saves your words, history, glossary and languages to a file in a folder you choose. Restore adds them from a file, on this
        phone or another device (the web app too). Nothing you already have is removed. Audio isn't included, so restored recordings can't
        be played or redone.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 60 },
  gap: { marginTop: 24 },
  help: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  testButton: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, gap: 12 },
  langs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  backupBtn: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 14 },
  langSum: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  levels: { flexDirection: 'row', gap: 8, marginTop: 10 },
  level: { flex: 1, alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 2, paddingVertical: 8, paddingHorizontal: 4 },
  levelImg: { width: 60, height: 60, borderRadius: 30 },
  lang: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
});

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { checkServer } from '../api';
import { Segmented } from '../components';
import { useColors } from '../theme';
import { Settings } from '../types';

type Props = {
  settings: Settings;
  onSave: (s: Settings) => void;
  onBack: () => void;
};

export default function SettingsScreen({ settings, onSave, onBack }: Props) {
  const c = useColors();
  const [s, setS] = useState(settings);
  const [showCode, setShowCode] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((prev) => ({ ...prev, [k]: v }));

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

  const input = [styles.input, { backgroundColor: c.card, borderColor: c.line, color: c.ink }];
  const label = [styles.label, { color: c.muted }];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={{ fontSize: 16, color: c.muted }}>Cancel</Text>
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: '600', color: c.ink }}>Settings</Text>
        <Pressable onPress={() => onSave({ ...s, serverUrl: s.serverUrl.trim(), apiToken: s.apiToken.trim() })} hitSlop={12}>
          <Text style={{ fontSize: 16, color: c.accent, fontWeight: '600' }}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={label}>Server address</Text>
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
        <Text style={[styles.help, { color: c.muted }]}>The link of your Render server, the same one you open in Chrome.</Text>

        <Text style={label}>Access code</Text>
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
            <Text style={{ color: c.accent, fontSize: 14 }}>{showCode ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        <Pressable onPress={test} style={styles.testButton} disabled={testing}>
          {testing ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: c.accent, fontSize: 15 }}>Test connection</Text>}
        </Pressable>
        {testResult && <Text style={[styles.help, { color: testResult.ok ? c.ok : c.rec }]}>{testResult.text}</Text>}

        <Text style={label}>Chinese characters</Text>
        <Segmented
          value={s.script}
          onChange={(v) => set('script', v)}
          options={[
            { value: 'simplified', label: 'Simplified 简体' },
            { value: 'traditional', label: 'Traditional 繁體' },
          ]}
          colors={c}
        />
        <Text style={[styles.help, { color: c.muted }]}>Used whenever Chinese is spoken or translated into.</Text>

        <Text style={label}>Translation style</Text>
        <Segmented
          value={s.style}
          onChange={(v) => set('style', v)}
          options={[
            { value: 'natural', label: 'Natural' },
            { value: 'literal', label: 'Literal' },
          ]}
          colors={c}
        />

        <View style={styles.switchRow}>
          <Text style={{ fontSize: 16, color: c.ink }}>Show pinyin</Text>
          <Switch value={s.pinyin} onValueChange={(v) => set('pinyin', v)} trackColor={{ true: c.accent }} />
        </View>

        <Text style={label}>Glossary</Text>
        <Text style={[styles.help, { color: c.muted, marginTop: 0, marginBottom: 8 }]}>
          One per line, in any of the languages. Helps names get heard correctly and translated consistently.
        </Text>
        <TextInput
          value={s.glossary}
          onChangeText={(v) => set('glossary', v)}
          multiline
          placeholder={'王小明 = Wang Xiaoming\nPak Budi = Mr Budi'}
          placeholderTextColor={c.faint}
          style={[input, { minHeight: 110, textAlignVertical: 'top' }]}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  body: { padding: 18, paddingBottom: 60 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 22, marginBottom: 8 },
  help: { fontSize: 13, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  testButton: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
});

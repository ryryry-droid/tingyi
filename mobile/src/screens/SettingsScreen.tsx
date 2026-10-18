import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { checkServer } from '../api';
import { colors } from '../theme';
import { Settings } from '../types';

type Props = {
  settings: Settings;
  onSave: (s: Settings) => void;
  onBack: () => void;
};

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[styles.segment, value === o.value && styles.segmentOn]}
        >
          <Text style={[styles.segmentText, value === o.value && styles.segmentTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function SettingsScreen({ settings, onSave, onBack }: Props) {
  const [s, setS] = useState(settings);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult({ ok: true, text: await checkServer(s) });
    } catch (e: any) {
      setTestResult({ ok: false, text: `Can't reach server: ${e?.message ?? e}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <Pressable onPress={() => onSave(s)} hitSlop={12}>
          <Text style={[styles.link, { color: colors.seal, fontWeight: '600' }]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Server address</Text>
        <TextInput
          value={s.serverUrl}
          onChangeText={(v) => set('serverUrl', v)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.10:8000"
          style={styles.input}
        />
        <Text style={styles.label}>API token (optional)</Text>
        <TextInput
          value={s.apiToken}
          onChangeText={(v) => set('apiToken', v)}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
        <Pressable onPress={test} style={styles.testButton} disabled={testing}>
          {testing ? <ActivityIndicator color={colors.seal} /> : <Text style={styles.testText}>Test connection</Text>}
        </Pressable>
        {testResult && (
          <Text style={[styles.help, { color: testResult.ok ? colors.ok : colors.seal }]}>{testResult.text}</Text>
        )}

        <Text style={styles.label}>Spoken language</Text>
        <Choice
          value={s.dialect}
          onChange={(v) => set('dialect', v)}
          options={[
            { value: 'mandarin', label: 'Mandarin 普通话' },
            { value: 'cantonese', label: 'Cantonese 粤语' },
          ]}
        />

        <Text style={styles.label}>Chinese characters</Text>
        <Choice
          value={s.script}
          onChange={(v) => set('script', v)}
          options={[
            { value: 'simplified', label: 'Simplified 简体' },
            { value: 'traditional', label: 'Traditional 繁體' },
          ]}
        />

        <Text style={styles.label}>Translation style</Text>
        <Choice
          value={s.style}
          onChange={(v) => set('style', v)}
          options={[
            { value: 'natural', label: 'Natural' },
            { value: 'literal', label: 'Literal' },
          ]}
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Show pinyin</Text>
          <Switch value={s.pinyin} onValueChange={(v) => set('pinyin', v)} trackColor={{ true: colors.seal }} />
        </View>

        <Text style={styles.label}>Glossary</Text>
        <Text style={styles.help}>
          One per line. Names and terms here are recognised more reliably and translated consistently.
        </Text>
        <TextInput
          value={s.glossary}
          onChangeText={(v) => set('glossary', v)}
          multiline
          placeholder={'王小明 = Wang Xiaoming\n云计算 = cloud computing'}
          style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.ink },
  link: { fontSize: 16, color: colors.muted },
  body: { padding: 20, paddingBottom: 60 },
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 22, marginBottom: 8 },
  help: { fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 4 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  testButton: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 6 },
  testText: { color: colors.seal, fontSize: 15 },
  segmented: { flexDirection: 'row', backgroundColor: colors.line, borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.card },
  segmentText: { fontSize: 14, color: colors.muted },
  segmentTextOn: { color: colors.ink, fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
  switchLabel: { fontSize: 16, color: colors.ink },
});

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, pinyinTones } from './theme';

/** Tone-coloured pinyin line. */
export function Pinyin({ value, colors }: { value?: string | null; colors: Colors }) {
  if (!value) return null;
  const parts = pinyinTones(value);
  return (
    <Text style={{ fontSize: 14, marginTop: 2, letterSpacing: 0.2 }}>
      {parts.map((p, i) => (
        <Text key={i} style={{ color: colors.tones[p.tone] }}>
          {p.syl}
          {i < parts.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </Text>
  );
}

/** A labelled button that opens a list to choose from. */
export function Picker<T extends string>({
  label,
  value,
  options,
  disabled = [],
  onChange,
  colors,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: T[];
  onChange: (v: T) => void;
  colors: Colors;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[styles.pickLabel, { color: colors.muted }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        onPress={() => setOpen(true)}
        style={[styles.pickBtn, { backgroundColor: colors.card, borderColor: colors.line }]}
      >
        <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 16 }}>
          {current}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <Text style={[styles.sheetTitle, { color: colors.muted }]}>{label}</Text>
            {options.map((o) => {
              const off = disabled.includes(o.value);
              const on = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  disabled={off}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={[styles.option, on && { backgroundColor: colors.accentSoft }]}
                >
                  <Text style={{ fontSize: 17, color: off ? colors.faint : on ? colors.accent : colors.ink, fontWeight: on ? '600' : '400' }}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Row of mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  colors,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  colors: Colors;
}) {
  return (
    <View style={[styles.segmented, { backgroundColor: colors.line }]}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[styles.segment, value === o.value && { backgroundColor: colors.card }]}
        >
          <Text style={{ fontSize: 14, color: value === o.value ? colors.ink : colors.muted, fontWeight: value === o.value ? '600' : '400' }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pickLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  pickBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 32, gap: 4 },
  sheetTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginLeft: 8 },
  option: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10 },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
});

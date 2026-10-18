import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { Colors, pinyinTones, useColors } from './theme';
import { isTappable, Token } from './words';

/** Tone-coloured pinyin line. */
export function Pinyin({ value, size = 14, style }: { value?: string | null; size?: number; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  if (!value) return null;
  const parts = pinyinTones(value);
  return (
    <Text style={[{ fontSize: size, marginTop: 2, letterSpacing: 0.2 }, style]}>
      {parts.map((p, i) => (
        <Text key={i} style={{ color: c.tones[p.tone] }}>
          {p.syl}
          {i < parts.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </Text>
  );
}

/** A language picker drawn as one of the logo's speech bubbles; opens a list to choose from. */
export function LangBubble<T extends string>({
  label,
  value,
  options,
  disabled = [],
  onChange,
  tone,
  locked,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: string[];
  onChange: (v: T) => void;
  tone: 'sky' | 'yellow';
  locked?: boolean;
}) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  const bg = tone === 'sky' ? c.sky : c.yellow;
  const ink = tone === 'sky' ? c.skyInk : c.yellowInk;
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        disabled={locked}
        onPress={() => setOpen(true)}
        style={[styles.bubble, { backgroundColor: bg }]}
      >
        <Text style={[styles.bubbleLabel, { color: ink }]}>{label.toUpperCase()}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.bubbleValue, { color: ink }]}>
          {current}
        </Text>
      </Pressable>
      <View style={[styles.tail, { backgroundColor: bg }, tone === 'sky' ? { left: 18 } : { right: 18 }]} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: c.surface }]}>
            <Text style={[styles.sheetTitle, { color: c.muted }]}>{label}</Text>
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
                  style={[styles.option, on && { backgroundColor: c.accentSoft }]}
                >
                  <Text style={{ fontSize: 17, color: off ? c.faint : on ? c.accent : c.ink, fontWeight: on ? '800' : '600' }}>
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
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.line }]}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.surface }]}
          >
            <Text numberOfLines={1} style={{ fontSize: 14, color: on ? c.ink : c.muted, fontWeight: on ? '800' : '600' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'stop' | 'small';
export function Btn({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress?: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = kind === 'secondary' ? c.surface2 : kind === 'stop' ? c.rec : c.accent;
  const ink = kind === 'secondary' ? c.ink : c.accentInk;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        kind === 'small' ? styles.small : styles.btn,
        { backgroundColor: bg },
        kind !== 'small' && kind !== 'secondary' && { flex: 1 },
        (disabled || pressed) && { opacity: disabled ? 0.45 : 0.8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <Text style={{ color: ink, fontSize: kind === 'small' ? 14 : 16, fontWeight: '800' }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextBtn({ title, onPress, color, bold }: { title: string; onPress: () => void; color?: string; bold?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button">
      <Text style={{ fontSize: 15, color: color || c.muted, fontWeight: bold ? '800' : '600', paddingVertical: 6 }}>{title}</Text>
    </Pressable>
  );
}

/** Bottom sheet. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.bigSheet, { backgroundColor: c.surface }]}>
          <View style={[styles.grab, { backgroundColor: c.line }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Pulsing dot for "working…" states. */
export function Working({ text }: { text: string }) {
  const c = useColors();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={{ alignItems: 'center', gap: 14, paddingVertical: 22 }}>
      <Animated.View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: c.accent,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
        }}
      />
      <Text style={{ color: c.muted, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>{text}</Text>
    </View>
  );
}

/** Text whose words can be tapped (selected range highlighted). */
export function WordText({
  tokens,
  style,
  onWord,
  sel,
}: {
  tokens: Token[];
  style: StyleProp<TextStyle>;
  onWord?: (k: number) => void;
  sel?: [number, number] | null;
}) {
  const c = useColors();
  return (
    <Text style={style} selectable={!onWord}>
      {tokens.map((tk, k) => {
        if (!onWord || !isTappable(tk)) return tk.t;
        const on = !!sel && k >= sel[0] && k <= sel[1];
        return (
          <Text
            key={k}
            onPress={() => onWord(k)}
            suppressHighlighting
            style={on ? { backgroundColor: c.yellowSoft, textDecorationLine: 'underline', textDecorationColor: c.yellow } : undefined}
          >
            {tk.t}
          </Text>
        );
      })}
    </Text>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <Text style={[styles.label, { color: c.muted }, style]}>{children}</Text>;
}

export function sheetStyles(c: Colors) {
  return StyleSheet.create({
    h2: { fontSize: 21, fontWeight: '800', color: c.ink },
    k: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: c.faint, fontWeight: '700' },
    p: { fontSize: 15, color: c.ink, lineHeight: 21 },
    pos: {
      alignSelf: 'flex-start',
      fontSize: 12,
      color: c.accent,
      backgroundColor: c.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 2,
      marginTop: 6,
      fontWeight: '700',
      overflow: 'hidden',
    },
    ex: { backgroundColor: c.bg, borderRadius: 14, padding: 14, gap: 3 },
    notice: { backgroundColor: c.warnSoft, color: c.warn, borderRadius: 10, padding: 12, fontSize: 14, overflow: 'hidden' },
  });
}

const styles = StyleSheet.create({
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 8 },
  bubbleLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  bubbleValue: { fontSize: 16, fontWeight: '800', marginTop: 1 },
  tail: { position: 'absolute', bottom: -6, width: 14, height: 14, transform: [{ rotate: '45deg' }], borderRadius: 2, zIndex: -1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 32, gap: 4 },
  sheetTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginLeft: 8, fontWeight: '700' },
  option: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12 },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center' },
  btn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  small: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', alignSelf: 'center' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.38)' },
  bigSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 18, paddingBottom: 26, maxHeight: '86%' },
  grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: -6, marginBottom: 12 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700', marginBottom: 8 },
});

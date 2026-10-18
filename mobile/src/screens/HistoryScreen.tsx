import { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Label } from '../components';
import { formatDate, HAN_FONT, useColors } from '../theme';
import { hasHan, Session } from '../types';

const REVEAL = 96;

type Props = {
  sessions: Session[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

export default function HistoryScreen({ sessions, onOpen, onDelete }: Props) {
  const c = useColors();
  const [openId, setOpenId] = useState<string | null>(null);
  const [scrollable, setScrollable] = useState(true);

  return (
    <View style={{ flex: 1, paddingHorizontal: 16 }}>
      <Label style={{ marginTop: 6 }}>Your recordings</Label>
      {sessions.length ? <Text style={[styles.tip, { color: c.faint }]}>Swipe a recording left to delete it.</Text> : null}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        scrollEnabled={scrollable}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={<Text style={[styles.empty, { color: c.muted }]}>Recordings you translate are saved here, on this phone.</Text>}
        renderItem={({ item }) => (
          <SwipeRow
            open={openId === item.id}
            onOpenChange={(o) => setOpenId(o ? item.id : null)}
            onDragging={(d) => setScrollable(!d)}
            onPress={() => {
              if (openId) setOpenId(null); // a tap closes an open row
              else onOpen(item.id);
            }}
            onDelete={() => {
              setOpenId(null);
              onDelete(item.id);
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
              <Text style={[styles.title, { color: c.ink }, hasHan(item.title) && { fontFamily: HAN_FONT }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={{ fontSize: 13, color: c.faint, fontVariant: ['tabular-nums'] }}>{formatDate(item.createdAt)}</Text>
            </View>
            <Text style={{ fontSize: 14, color: item.status === 'error' ? c.rec : c.muted, marginTop: 3 }} numberOfLines={1}>
              {item.status === 'processing'
                ? 'Translating…'
                : item.status === 'error'
                  ? 'Failed. Tap to retry.'
                  : item.segments[0]?.translation || 'No speech found'}
            </Text>
          </SwipeRow>
        )}
      />
    </View>
  );
}

/** A row that slides left to reveal a Delete button on its right. */
function SwipeRow({
  open,
  onOpenChange,
  onDragging,
  onPress,
  onDelete,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDragging: (d: boolean) => void;
  onPress: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const c = useColors();
  const x = useRef(new Animated.Value(open ? -REVEAL : 0)).current;
  const [dragging, setDragging] = useState(false);
  const props = useRef({ open, onOpenChange, onDragging });
  props.current = { open, onOpenChange, onDragging };
  const start = useRef(0);

  useEffect(() => {
    if (!dragging) Animated.timing(x, { toValue: open ? -REVEAL : 0, duration: 180, useNativeDriver: true }).start();
  }, [open]);

  const settle = (dx: number) => {
    setDragging(false);
    props.current.onDragging(false);
    const o = start.current + dx < -REVEAL / 2;
    Animated.timing(x, { toValue: o ? -REVEAL : 0, duration: 180, useNativeDriver: true }).start();
    props.current.onOpenChange(o);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => {
        start.current = props.current.open ? -REVEAL : 0;
        setDragging(true);
        props.current.onDragging(true);
      },
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, Math.max(-REVEAL - 24, start.current + g.dx))),
      onPanResponderRelease: (_, g) => settle(g.dx),
      onPanResponderTerminate: (_, g) => settle(g.dx),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const showDelete = open || dragging;
  return (
    <View style={[styles.row, { borderBottomColor: c.line }]}>
      {showDelete ? (
        <Pressable onPress={onDelete} style={[styles.del, { backgroundColor: c.rec }]} accessibilityRole="button" accessibilityLabel="Delete">
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Delete</Text>
        </Pressable>
      ) : null}
      <Animated.View
        {...pan.panHandlers}
        style={{ transform: [{ translateX: x }], backgroundColor: showDelete ? c.bg : 'transparent' }}
      >
        <Pressable onPress={onPress} style={{ paddingVertical: 14 }}>
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: { fontSize: 12, marginBottom: 4 },
  empty: { fontSize: 15, paddingVertical: 18 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  del: { position: 'absolute', right: 0, top: 0, bottom: 0, width: REVEAL, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
});

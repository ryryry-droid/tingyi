import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Btn, Segmented, Sheet, sheetStyles } from '../components';
import { HAN_FONT, useColors } from '../theme';
import { isChinese, LANGS, Settings } from '../types';

export type InputKind = 'photo' | 'text';

type Props = {
  settings: Settings;
  tab: InputKind;
  onClose: () => void;
  /** photoUri: a smaller copy of the photo, kept in the app's own folder */
  onTranslate: (kind: InputKind, value: { photoUri?: string; text?: string }) => void;
};

/** Translate a photo or pasted text: pick it here, and it's translated line by line like a recording. */
export default function InputSheet({ settings, tab: firstTab, onClose, onTranslate }: Props) {
  const c = useColors();
  const sh = sheetStyles(c);
  const [tab, setTab] = useState<InputKind>(firstTab);
  const [photo, setPhoto] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const han = isChinese(settings.source);

  async function pick(camera: boolean) {
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      }
      const r = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (r.canceled || !r.assets?.[0]) return;
      setBusy(true);
      const a = r.assets[0];
      // small enough to send quickly: the longest side at most 1600 px
      const ctx = ImageManipulator.manipulate(a.uri);
      if (Math.max(a.width, a.height) > 1600) ctx.resize(a.width >= a.height ? { width: 1600 } : { height: 1600 });
      const img = await (await ctx.renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      const dest = new File(Paths.document, `photo-${Date.now()}.jpg`);
      new File(img.uri).copy(dest);
      setPhoto({ uri: dest.uri, w: img.width, h: img.height });
    } catch {
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    const t = await Clipboard.getStringAsync().catch(() => '');
    if (t) setText((x) => (x ? x + '\n' : '') + t);
  }

  function go() {
    if (tab === 'photo' && photo) onTranslate('photo', { photoUri: photo.uri });
    else if (tab === 'text' && text.trim()) onTranslate('text', { text: text.trim() });
  }

  return (
    <Sheet visible onClose={onClose}>
      <Text style={sh.h2}>Translate a photo or text</Text>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'photo', label: '📷 Photo' },
          { value: 'text', label: '✎ Text' },
        ]}
      />
      {tab === 'photo' ? (
        photo ? (
          <Image source={{ uri: photo.uri }} style={[styles.photo, { aspectRatio: photo.w / photo.h || 1.4 }]} resizeMode="contain" />
        ) : (
          <View style={styles.pickRow}>
            <Pressable onPress={() => pick(true)} disabled={busy} style={[styles.pick, { borderColor: c.line }]}>
              <Text style={{ fontSize: 30 }}>📷</Text>
              <Text style={{ color: c.muted, fontWeight: '700' }}>Take a photo</Text>
            </Pressable>
            <Pressable onPress={() => pick(false)} disabled={busy} style={[styles.pick, { borderColor: c.line }]}>
              <Text style={{ fontSize: 30 }}>🖼</Text>
              <Text style={{ color: c.muted, fontWeight: '700' }}>Choose a photo</Text>
            </Pressable>
          </View>
        )
      ) : (
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          placeholder={`Paste or type ${LANGS[settings.source] || ''} text`}
          placeholderTextColor={c.faint}
          textAlignVertical="top"
          style={[styles.text, { borderColor: c.line, backgroundColor: c.bg, color: c.ink }, han && { fontFamily: HAN_FONT }]}
        />
      )}
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }}>
        {LANGS[settings.source]} → {LANGS[settings.target]}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {tab === 'photo' ? (
          photo ? <Btn title="Retake" kind="secondary" onPress={() => setPhoto(null)} /> : null
        ) : (
          <Btn title="Paste" kind="secondary" onPress={paste} />
        )}
        <Btn
          title={busy ? 'Opening…' : 'Translate'}
          style={{ flex: 1 }}
          disabled={busy || (tab === 'photo' ? !photo : !text.trim())}
          onPress={go}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', maxHeight: 360, borderRadius: 14 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pick: { flex: 1, minHeight: 150, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  text: { minHeight: 180, maxHeight: 320, borderWidth: 1.5, borderRadius: 14, padding: 12, fontSize: 17, lineHeight: 25 },
});

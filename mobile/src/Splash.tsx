import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ImageSourcePropType, Pressable, StyleSheet, Text } from 'react-native';

// Chatot pops out of the grass, looks around and flies off, with the shiny sparkle sound.
// Plays every time the app opens; tap anywhere to skip.
const FRAMES = [
  require('../assets/splash/f1.jpg'),
  require('../assets/splash/f2.jpg'),
  require('../assets/splash/f3.jpg'),
  require('../assets/splash/f4.jpg'),
  require('../assets/splash/f5.jpg'),
  require('../assets/splash/f6.jpg'),
  require('../assets/splash/f7.jpg'),
  require('../assets/splash/f8.jpg'),
  require('../assets/splash/f9.jpg'),
];
const DURATIONS = [160, 160, 220, 420, 300, 220, 160, 180, 300]; // ms each frame stays up
const SHINY = require('../assets/shiny.mp3');
const SIZE = 220;

type Props = { bg: string; wordmark: ImageSourcePropType; hint: string; onDone: () => void };

export default function Splash({ bg, wordmark, hint, onDone }: Props) {
  const [frame, setFrame] = useState(0);
  const scale = useRef(new Animated.Value(0.6)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);
  const sound = useRef<AudioPlayer | null>(null);

  function finish(fast: boolean) {
    if (finished.current) return;
    finished.current = true;
    if (fast) {
      try {
        sound.current?.pause();
      } catch {}
    }
    Animated.timing(fade, { toValue: 0, duration: fast ? 150 : 280, useNativeDriver: true }).start(() => onDone());
  }

  useEffect(() => {
    try {
      sound.current = createAudioPlayer(SHINY);
      sound.current.play();
    } catch {}
    Animated.timing(scale, { toValue: 1, duration: 220, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = 120;
    DURATIONS.forEach((d, i) => {
      timers.push(setTimeout(() => setFrame(i), t));
      t += d;
    });
    timers.push(setTimeout(() => finish(false), t));
    return () => {
      timers.forEach(clearTimeout);
      // let the sound finish on its own, then free it
      const p = sound.current;
      setTimeout(() => {
        try {
          p?.remove();
        } catch {}
      }, 1500);
    };
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: fade, zIndex: 100 }]}>
      <Pressable style={styles.fill} onPress={() => finish(true)} accessibilityRole="button" accessibilityLabel="Skip">
        <Animated.View style={[styles.circle, { transform: [{ scale }] }]}>
          {/* every frame stays mounted, so switching between them never flickers */}
          {FRAMES.map((src, i) => (
            <Image key={i} source={src} style={[StyleSheet.absoluteFill, { width: SIZE, height: SIZE, opacity: i === frame ? 1 : 0 }]} fadeDuration={0} />
          ))}
        </Animated.View>
        <Image source={wordmark} style={styles.wordmark} resizeMode="contain" />
        <Text style={[styles.skip, { color: hint }]}>Tap to skip</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, overflow: 'hidden', backgroundColor: '#86C5F5' },
  wordmark: { width: 150, height: 105, marginTop: 30 },
  skip: { position: 'absolute', bottom: 60, fontSize: 13 },
});

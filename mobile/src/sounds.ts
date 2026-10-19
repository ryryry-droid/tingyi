import { AudioPlayer, createAudioPlayer } from 'expo-audio';

// Chatot's cry (record button, right answers) and the wrong-answer sound, loaded once and reused.
const CRY = require('../assets/chatot.mp3');
const WRONG = require('../assets/wrong.mp3');
let cry: AudioPlayer | null = null;
let wrong: AudioPlayer | null = null;

// Chatot slider levels in Settings, each shown with a frame of the opening animation
export const LEVELS: { id: string; name: string; volume: number; img: number }[] = [
  { id: 'off', name: 'Off', volume: 0, img: require('../assets/splash/f1.jpg') },
  { id: 'soft', name: 'Soft', volume: 10, img: require('../assets/splash/f3.jpg') },
  { id: 'medium', name: 'Medium', volume: 30, img: require('../assets/splash/f4.jpg') },
  { id: 'loud', name: 'Loud', volume: 100, img: require('../assets/splash/f5.jpg') },
];
export const levelOf = (v: number) => LEVELS.reduce((best, l) => (Math.abs(l.volume - v) < Math.abs(best.volume - v) ? l : best));
let volume = 0.1;
/** Set from Settings; snapped to one of the levels. */
export function setSoundVolume(v: number) {
  volume = levelOf(Number(v)).volume / 100;
}

function player(which: 'cry' | 'wrong'): AudioPlayer {
  if (which === 'cry') return (cry = cry || createAudioPlayer(CRY));
  return (wrong = wrong || createAudioPlayer(WRONG));
}

async function play(which: 'cry' | 'wrong') {
  const p = player(which);
  p.volume = volume;
  try {
    await p.seekTo(0);
  } catch {}
  p.play();
}

/** Plays the cry and resolves when it has finished (about a second), so recording can start after it. */
export async function playCry(): Promise<void> {
  if (!volume) return; // off: no cry and no wait
  try {
    await play('cry');
  } catch {
    return;
  }
  await new Promise((r) => setTimeout(r, 1150));
}

export function playWrong() {
  if (!volume) return;
  play('wrong').catch(() => {});
}

/** Load the sounds ahead of time so the first one plays straight away. */
export function preloadSounds() {
  try {
    player('cry');
    player('wrong');
  } catch {}
}

import { AudioPlayer, createAudioPlayer } from 'expo-audio';

// Chatot's cry (record button, right answers) and the wrong-answer sound, loaded once and reused.
const CRY = require('../assets/chatot.mp3');
const WRONG = require('../assets/wrong.mp3');
let cry: AudioPlayer | null = null;
let wrong: AudioPlayer | null = null;

function player(which: 'cry' | 'wrong'): AudioPlayer {
  if (which === 'cry') return (cry = cry || createAudioPlayer(CRY));
  return (wrong = wrong || createAudioPlayer(WRONG));
}

async function play(which: 'cry' | 'wrong') {
  const p = player(which);
  try {
    await p.seekTo(0);
  } catch {}
  p.play();
}

/** Plays the cry and resolves when it has finished (about a second), so recording can start after it. */
export async function playCry(): Promise<void> {
  try {
    await play('cry');
  } catch {
    return;
  }
  await new Promise((r) => setTimeout(r, 1150));
}

export function playWrong() {
  play('wrong').catch(() => {});
}

/** Load the sounds ahead of time so the first one plays straight away. */
export function preloadSounds() {
  try {
    player('cry');
    player('wrong');
  } catch {}
}

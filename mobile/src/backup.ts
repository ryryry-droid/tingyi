import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';

import { caseFor, CATALOG, fixPair, Session, Settings, Word, wordId } from './types';

// The same file format as the web app, so a backup made on one can be restored on the other.
// Audio isn't included (it would make the file huge).
type Backup = {
  app: 'chattalk';
  version: 1;
  exportedAt: number;
  words: Word[];
  sessions: Omit<Session, 'audioUri'>[];
  glossary: string;
  langs: string[];
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Asks for a folder (Downloads, Drive...) and writes the backup there. Returns a message for the toast, or null if cancelled. */
export async function backUp(words: Word[], sessions: Session[], settings: Settings): Promise<string | null> {
  const data: Backup = {
    app: 'chattalk',
    version: 1,
    exportedAt: Date.now(),
    words,
    sessions: sessions.filter((s) => s.status === 'done').map(({ audioUri, ...rest }) => rest),
    glossary: settings.glossary,
    langs: settings.langs,
  };
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return null; // cancelled
  }
  if (!dir) return null;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `chattalk-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const file = dir.createFile(name, 'application/json');
  file.write(JSON.stringify(data));
  return `Saved ${plural(data.words.length, 'word')} and ${plural(data.sessions.length, 'recording')}`;
}

export type Restored = { words: Word[]; sessions: Session[]; settings: Settings; message: string };

/** Lets you pick a backup file and adds what's in it. Nothing you already have is removed or changed. */
export async function restore(words: Word[], sessions: Session[], settings: Settings): Promise<Restored | null> {
  const pick = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (pick.canceled || !pick.assets?.[0]) return null;
  let data: Partial<Backup>;
  try {
    data = JSON.parse(await new File(pick.assets[0].uri).text());
  } catch {
    throw new Error('That file isn’t a ChatTalk backup');
  }
  if (!data || data.app !== 'chattalk' || !Array.isArray(data.words)) throw new Error('That file isn’t a ChatTalk backup');
  return merge(data, words, sessions, settings);
}

export function merge(data: Partial<Backup>, words: Word[], sessions: Session[], settings: Settings): Restored {
  const have = new Set(words.map((w) => w.id));
  const newWords: Word[] = [];
  for (const w of data.words || []) {
    if (!w || !w.word || !w.lang) continue;
    const id = wordId(w.lang, w.word);
    if (have.has(id)) continue;
    have.add(id);
    newWords.push({ ...w, id, word: caseFor(w.word, w.part_of_speech), root: caseFor(w.root, w.part_of_speech) });
  }
  const haveS = new Set(sessions.map((s) => s.id));
  const newSessions: Session[] = [];
  for (const x of (data.sessions || []) as any[]) {
    if (!x || !x.id || haveS.has(x.id) || !Array.isArray(x.segments)) continue;
    haveS.add(x.id);
    newSessions.push({
      ...x,
      status: 'done',
      audioUri: '', // no audio in a backup
      // the web app's older recordings used zh / en for the text and translation
      segments: x.segments.map((g: any) => ({ ...g, text: g.text ?? g.zh ?? '', translation: g.translation ?? g.en ?? '' })),
    });
  }
  const lines = settings.glossary.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of String(data.glossary || '').split('\n').map((l) => l.trim()).filter(Boolean)) if (!lines.includes(l)) lines.push(l);
  const known = new Set(CATALOG.map(([c]) => c));
  const langs = [...settings.langs];
  for (const c of data.langs || []) if (known.has(c) && !langs.includes(c)) langs.push(c);
  const nw = newWords.length;
  const ns = newSessions.length;
  return {
    words: [...words, ...newWords].sort((a, b) => b.createdAt - a.createdAt),
    sessions: [...sessions, ...newSessions].sort((a, b) => b.createdAt - a.createdAt),
    settings: { ...settings, glossary: lines.join('\n'), langs, ...fixPair(langs, settings.source, settings.target) },
    message: nw || ns ? `Added ${plural(nw, 'word')} and ${plural(ns, 'recording')}` : 'Nothing new. You already have everything in that backup.',
  };
}

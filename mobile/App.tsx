import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, ImageBackground, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { checkRegister, checkServer, checkTheme, convertScript, translateRecording } from './src/api';
import { bankWord, loadBank, loadBankProgress, saveBankResult } from './src/bank';
import BankScreen from './src/screens/BankScreen';
import { backUp, restore } from './src/backup';
import { preloadSounds, setSoundVolume } from './src/sounds';
import Splash from './src/Splash';
import HistoryScreen from './src/screens/HistoryScreen';
import ListenScreen from './src/screens/ListenScreen';
import LiveScreen, { LiveResult } from './src/screens/LiveScreen';
import RecordScreen, { StopReason } from './src/screens/RecordScreen';
import SessionScreen from './src/screens/SessionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TestScreen from './src/screens/TestScreen';
import { loadReviewDays } from './src/review';
import WordsScreen from './src/screens/WordsScreen';
import {
  deleteAudio,
  loadSessions,
  loadSettings,
  loadTestSetup,
  loadWords,
  saveSessions,
  saveSettings,
  saveTestSetup,
  saveWords,
} from './src/storage';
import { formatDate, formatTime, PALETTES, ThemeContext } from './src/theme';
import { DEFAULT_SETTINGS, DEFAULT_TEST_SETUP, isChinese, Segment, Session, Settings, TestSetup, Word, wordId } from './src/types';

type Tab = 'record' | 'history' | 'words' | 'settings';
type Route =
  | { name: 'tab' }
  | { name: 'session'; id: string }
  | { name: 'live'; mode: 'subtitles' | 'conversation' }
  | { name: 'test'; only?: Word[]; key: number; bank?: Word[]; review?: boolean }
  | { name: 'bank' }
  | { name: 'listen'; key: number };
type Toast = { msg: string; action?: { label: string; run: () => void } } | null;

const TABS: [Tab, string][] = [
  ['record', 'Record'],
  ['history', 'History'],
  ['words', 'Words'],
  ['settings', 'Settings'],
];
const WORDMARK = { dark: require('./assets/wordmark-dark.png'), light: require('./assets/wordmark-light.png') };
const BG_LIGHT = require('./assets/bg-light.jpg');

export default function App() {
  const [ready, setReady] = useState(false);
  const [splash, setSplash] = useState(true); // the opening animation, every time the app opens
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [words, setWords] = useState<Word[]>([]);
  const [testSetup, setTestSetup] = useState<TestSetup>(DEFAULT_TEST_SETUP);
  const [tab, setTab] = useState<Tab>('record');
  const [route, setRoute] = useState<Route>({ name: 'tab' });
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const c = PALETTES[settings.theme] || PALETTES.dark;

  useEffect(() => {
    preloadSounds();
    Promise.all([loadSessions(), loadSettings(), loadWords(), loadTestSetup(), loadReviewDays()]).then(([sess, sett, w, t]) => {
      setSessions(sess);
      setSettings(sett);
      setWords(w);
      setTestSetup(t);
      setReady(true);
      // wake the free server while the opening animation plays (it sleeps when unused), so the first recording is quicker
      if (sett.serverUrl) checkServer(sett).catch(() => {});
    });
  }, []);

  useEffect(() => setSoundVolume(settings.volume), [settings.volume]);
  useEffect(() => {
    if (ready) saveSessions(sessions);
  }, [sessions, ready]);
  useEffect(() => {
    if (ready) saveWords(words);
  }, [words, ready]);

  // Words saved before colloquial/standard was recorded: ask the server once, in the background
  useEffect(() => {
    if (!ready || !settings.serverUrl) return;
    const todo = words.filter((w) => !w.register && w.lang !== 'zh');
    if (!todo.length) return;
    (async () => {
      const langs = [...new Set(todo.map((w) => w.lang))];
      for (const lang of langs) {
        const list = todo.filter((w) => w.lang === lang).slice(0, 100);
        try {
          const { results } = await checkRegister(settingsRef.current, lang, list.map((w) => w.word));
          const found = new Map(results.map((r) => [r.word, r]));
          setWords((prev) =>
            prev.map((w) => {
              const r = w.lang === lang ? found.get(w.word) : undefined;
              return r ? { ...w, register: r.register, standard: r.standard || '' } : w;
            }),
          );
        } catch {
          return;
        }
      }
    })();
  }, [ready]);
  // Daily / Technical for each word (testing by theme): asked once per word, in the background
  const themesRunning = useRef(false);
  useEffect(() => {
    if (!ready || !settings.serverUrl || themesRunning.current) return;
    const todo = words.filter((w) => !w.theme);
    if (!todo.length) return;
    themesRunning.current = true;
    (async () => {
      try {
        for (const lang of [...new Set(todo.map((w) => w.lang))]) {
          const list = todo.filter((w) => w.lang === lang).slice(0, 100);
          const { results } = await checkTheme(settingsRef.current, lang, list.map((w) => ({ word: w.word, meaning: w.meaning || '' })));
          const found = new Map(results.map((r) => [r.word, r.theme]));
          setWords((prev) => prev.map((w) => (w.lang === lang && !w.theme && found.has(w.word) ? { ...w, theme: found.get(w.word) } : w)));
        }
      } catch {}
      themesRunning.current = false;
    })();
  }, [ready, words.length]);

  // Word bank summary for Settings
  const [bankSummary, setBankSummary] = useState('');
  useEffect(() => {
    if (!ready || tab !== 'settings' || route.name !== 'tab') return;
    Promise.all([loadBank(settingsRef.current), loadBankProgress()]).then(([terms, prog]) =>
      setBankSummary(`${terms.length} terms · ${Object.keys(prog).length} tested`),
    );
  }, [ready, tab, route.name]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  const busy = recording || route.name === 'live';

  // Android back button: back to the list a screen came from, then to Record, then out
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'live') return true; // stop live mode with its Stop button
      if (route.name === 'session') {
        setRoute({ name: 'tab' });
        setTab('history');
        return true;
      }
      if (route.name === 'bank' || (route.name === 'test' && route.bank)) {
        setRoute(route.name === 'bank' ? { name: 'tab' } : { name: 'bank' });
        if (route.name === 'bank') setTab('settings');
        return true;
      }
      if (route.name === 'test' || route.name === 'listen') {
        setRoute({ name: 'tab' });
        setTab('words');
        return true;
      }
      if (tab !== 'record' && !busy) {
        setTab('record');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route, tab, busy]);

  // ---------- helpers ----------
  function showToast(msg: string, action?: { label: string; run: () => void }) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 2000);
  }

  function buzz(kind: 'stopped' | 'alert') {
    if (!settingsRef.current.vibrate) return;
    Vibration.vibrate(kind === 'stopped' ? 90 : [0, 400, 150, 400, 150, 600]);
  }

  function updateSettings(next: Settings) {
    const was = settingsRef.current.script;
    setSettings(next);
    saveSettings(next);
    if (next.script !== was) convertWords(next);
  }

  // Changing Chinese characters also changes the Chinese words you've already saved
  async function convertWords(s: Settings) {
    const FIELDS = ['word', 'root', 'sentence', 'meaning', 'in_context', 'notes', 'standard'];
    const list = wordsRef.current.filter((w) => isChinese(w.lang));
    if (!list.length) return;
    const texts: string[] = [];
    for (const w of list) {
      for (const f of FIELDS) texts.push((w as any)[f] || '');
      texts.push(w.example?.text || '');
    }
    let out: string[];
    try {
      out = (await convertScript(s, s.script, texts)).texts;
    } catch {
      showToast('Couldn’t change your saved words. Try again when the server is awake.');
      return;
    }
    if (settingsRef.current.script !== s.script) return; // changed again meanwhile
    const changed = new Map<string, Word>();
    let k = 0;
    for (const w of list) {
      const nw: any = { ...w };
      for (const f of FIELDS) {
        const v = out[k++];
        if ((w as any)[f]) nw[f] = v;
      }
      const ex = out[k++];
      if (w.example?.text) nw.example = { ...w.example, text: ex };
      nw.id = wordId(nw.lang, nw.word);
      if (JSON.stringify(nw) !== JSON.stringify(w)) changed.set(w.id, nw);
    }
    if (!changed.size) return;
    setWords((prev) => {
      const taken = new Set(prev.filter((x) => !changed.has(x.id)).map((x) => x.id));
      const next: Word[] = [];
      for (const x of prev) {
        const nw = changed.get(x.id) || x;
        if (changed.has(x.id) && taken.has(nw.id)) continue; // you already have it in this script
        taken.add(nw.id);
        next.push(nw);
      }
      return next;
    });
    showToast(`Changed ${changed.size} saved ${changed.size === 1 ? 'word' : 'words'} to ${s.script === 'traditional' ? 'Traditional' : 'Simplified'}`);
  }

  function updateSession(id: string, change: (s: Session) => Session) {
    setSessions((prev) => prev.map((s) => (s.id === id ? change(s) : s)));
  }

  async function process(session: Session) {
    updateSession(session.id, (s) => ({ ...s, status: 'processing', error: undefined }));
    try {
      const result = await translateRecording(settingsRef.current, session);
      const first = result.segments[0]?.text;
      updateSession(session.id, (s) => ({
        ...s,
        status: 'done',
        segments: result.segments,
        duration: result.duration || s.duration,
        title: result.title || (first ? (first.length > 30 ? first.slice(0, 30) + '…' : first) : s.title),
        // the transcript came back but translating failed: keep it, and offer to translate the missing lines
        untranslated: result.translation_error || '',
      }));
    } catch (e: any) {
      updateSession(session.id, (s) => ({ ...s, status: 'error', error: String(e?.message ?? e) }));
    }
  }

  function openSession(id: string) {
    setNotice('');
    setTab('history');
    setRoute({ name: 'session', id });
  }

  function onRecorded(audioUri: string, duration: number, fileName?: string) {
    const now = Date.now();
    const s = settingsRef.current;
    const session: Session = {
      id: String(now),
      title: fileName || `Recording ${formatDate(now)}`,
      createdAt: now,
      duration,
      audioUri,
      source: s.source,
      target: s.target,
      script: s.script,
      status: 'processing',
      segments: [],
    };
    setSessions((prev) => [session, ...prev]);
    openSession(session.id);
    process(session);
  }

  function onStopped(reason: StopReason, duration: number) {
    buzz(reason === 'user' ? 'stopped' : 'alert');
    setTimeout(() => {
      if (reason === 'limit') setNotice('Recording stopped at the 90-minute limit. Translating what was recorded.');
      else if (reason === 'lost')
        setNotice(
          `Recording stopped by itself at ${formatTime(duration)}: the microphone was probably taken by a call or another app. Translating what was recorded.`,
        );
    }, 50);
  }

  function onLiveDone(r: LiveResult) {
    if (r.session) {
      const s = r.session;
      setSessions((prev) => [s, ...prev]);
      openSession(s.id);
    } else {
      setRoute({ name: 'tab' });
      setTab('record');
    }
    if (r.message) setNotice(r.message);
  }

  // Delete with a few seconds to undo; the audio file is removed only once the chance to undo has passed
  const pendingDelete = useRef<{ s: Session; timer: ReturnType<typeof setTimeout> } | null>(null);
  function deleteWithUndo(id: string) {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const removed = sessions[idx];
    if (pendingDelete.current) {
      clearTimeout(pendingDelete.current.timer);
      deleteAudio(pendingDelete.current.s.audioUri);
    }
    pendingDelete.current = {
      s: removed,
      timer: setTimeout(() => {
        deleteAudio(removed.audioUri);
        pendingDelete.current = null;
      }, 6000),
    };
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (route.name === 'session') {
      setRoute({ name: 'tab' });
      setTab('history');
    }
    showToast('Recording deleted', {
      label: 'Undo',
      run: () => {
        if (pendingDelete.current?.s.id === removed.id) {
          clearTimeout(pendingDelete.current.timer);
          pendingDelete.current = null;
        }
        setSessions((prev) => {
          const next = prev.slice();
          next.splice(Math.min(idx, next.length), 0, removed);
          return next;
        });
      },
    });
  }

  function saveWord(w: Word) {
    setWords((prev) => [w, ...prev.filter((x) => x.id !== w.id)]);
  }
  function updateWord(w: Word) {
    setWords((prev) => prev.map((x) => (x.id === w.id ? w : x)));
  }
  function removeWord(id: string) {
    setWords((prev) => prev.filter((x) => x.id !== id));
  }

  function goTab(t: Tab) {
    if (busy) return;
    setNotice('');
    setTab(t);
    setRoute({ name: 'tab' });
  }

  const current = route.name === 'session' ? sessions.find((s) => s.id === route.id) : undefined;
  const selectedTab: Tab = route.name === 'session' ? 'history' : route.name === 'live' ? 'record' : route.name === 'bank' || (route.name === 'test' && route.bank) ? 'settings' : route.name === 'test' || route.name === 'listen' ? 'words' : tab;

  let screen: React.ReactNode;
  if (!ready) {
    screen = (
      <View style={styles.loading}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  } else if (route.name === 'live') {
    screen = <LiveScreen mode={route.mode} settings={settings} buzz={buzz} toast={showToast} onDone={onLiveDone} />;
  } else if (route.name === 'session' && current) {
    screen = (
      <SessionScreen
        key={current.id}
        session={current}
        settings={settings}
        words={words}
        onBack={() => goTab('history')}
        onNew={() => goTab('record')}
        onRetry={() => process(current)}
        onDelete={() => deleteWithUndo(current.id)}
        onRename={(title) => updateSession(current.id, (s) => ({ ...s, title }))}
        onUpdateSegment={(segId, changes) =>
          updateSession(current.id, (s) => ({
            ...s,
            segments: s.segments.map((seg: Segment) => (seg.id === segId ? { ...seg, ...changes } : seg)),
          }))
        }
        onTranslated={() => updateSession(current.id, (s) => ({ ...s, untranslated: '' }))}
        onSaveWord={saveWord}
        onRemoveWord={removeWord}
        toast={showToast}
      />
    );
  } else if (route.name === 'bank') {
    screen = (
      <BankScreen
        settings={settings}
        words={words}
        onBack={() => goTab('settings')}
        onTest={(terms) => setRoute({ name: 'test', key: Date.now(), bank: terms.map(bankWord) })}
        onSaveWord={saveWord}
        toast={showToast}
      />
    );
  } else if (route.name === 'listen') {
    screen = <ListenScreen key={route.key} settings={settings} words={words} setup={testSetup} onDone={() => goTab('words')} />;
  } else if (route.name === 'test') {
    screen = (
      <TestScreen
        key={route.key}
        settings={settings}
        words={words}
        setup={testSetup}
        only={route.only}
        bank={route.bank}
        review={route.review}
        onReviewMore={() => setRoute({ name: 'test', key: Date.now(), review: true })}
        onBankResult={(word, ok) => saveBankResult(word, ok)}
        onUpdateWord={updateWord}
        onAgain={(missed) =>
          setRoute({ name: 'test', only: route.bank ? missed : missed.map((m) => words.find((x) => x.id === m.id) || m), key: Date.now(), bank: route.bank })
        }
        onNew={() => (route.bank ? setRoute({ name: 'test', key: Date.now(), bank: route.bank }) : goTab('words'))}
        onDone={() => (route.bank ? setRoute({ name: 'bank' }) : goTab('words'))}
        buzzAnswer={(ok) => settings.vibrate && Vibration.vibrate(ok ? 30 : [0, 60, 60, 60])}
      />
    );
  } else if (tab === 'history') {
    screen = <HistoryScreen sessions={sessions} onOpen={openSession} onDelete={deleteWithUndo} />;
  } else if (tab === 'words') {
    screen = (
      <WordsScreen
        settings={settings}
        words={words}
        testSetup={testSetup}
        onTestSetup={(t) => {
          setTestSetup(t);
          saveTestSetup(t);
        }}
        onStartTest={() => setRoute({ name: 'test', key: Date.now() })}
        onReview={() => setRoute({ name: 'test', key: Date.now(), review: true })}
        onListen={() => setRoute({ name: 'listen', key: Date.now() })}
        onSaveWord={saveWord}
        onUpdateWord={updateWord}
        onDeleteWord={removeWord}
        toast={showToast}
      />
    );
  } else if (tab === 'settings') {
    screen = (
      <SettingsScreen
        settings={settings}
        onChange={updateSettings}
        toast={showToast}
        buzzPreview={() => Vibration.vibrate(90)}
        onOpenBank={() => setRoute({ name: 'bank' })}
        bankSummary={bankSummary}
        onBackup={async () => {
          try {
            const msg = await backUp(words, sessions, settingsRef.current);
            if (msg) showToast(msg);
          } catch (e: any) {
            Alert.alert('Couldn’t back up', String(e?.message ?? e));
          }
        }}
        onRestore={async () => {
          try {
            const r = await restore(words, sessions, settingsRef.current);
            if (!r) return;
            setWords(r.words);
            setSessions(r.sessions);
            updateSettings(r.settings);
            showToast(r.message);
          } catch (e: any) {
            Alert.alert('Couldn’t restore', String(e?.message ?? e));
          }
        }}
      />
    );
  } else {
    screen = (
      <RecordScreen
        settings={settings}
        onLanguages={(source, target) => updateSettings({ ...settingsRef.current, source, target })}
        onRecorded={onRecorded}
        onStopped={onStopped}
        onBusy={setRecording}
        onStartLive={(mode) => {
          setNotice('');
          setRoute({ name: 'live', mode });
        }}
        onSettings={() => goTab('settings')}
      />
    );
  }

  const body = (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Image source={c.dark ? WORDMARK.dark : WORDMARK.light} style={styles.wordmark} resizeMode="contain" accessibilityLabel="ChatTalk" />
        <View style={[styles.nav, { backgroundColor: c.surface, borderColor: c.line }]}>
          {TABS.map(([t, label]) => {
            const on = selectedTab === t;
            return (
              <Pressable
                key={t}
                onPress={() => goTab(t)}
                disabled={busy && !on}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.tab, on && { backgroundColor: c.accent }]}
              >
                <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: on ? '800' : '700', color: on ? c.accentInk : busy ? c.faint : c.muted }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {notice ? (
        <Pressable onPress={() => setNotice('')} style={[styles.notice, { backgroundColor: c.warnSoft }]}>
          <Text style={{ color: c.warn, fontSize: 14, fontWeight: '600' }}>{notice}</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>{screen}</View>
      {toast ? (
        <View style={[styles.toast, { backgroundColor: c.ink }]} pointerEvents="box-none">
          <Text style={{ color: c.bg, fontSize: 14, fontWeight: '600' }}>{toast.msg}</Text>
          {toast.action ? (
            <Pressable
              hitSlop={10}
              onPress={() => {
                const a = toast.action!;
                setToast(null);
                a.run();
              }}
            >
              <Text style={{ color: c.accentSoft, fontWeight: '800', fontSize: 14, textDecorationLine: 'underline' }}>{toast.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );

  return (
    <ThemeContext.Provider value={c}>
      <SafeAreaProvider>
        {c.dark ? (
          <View style={{ flex: 1, backgroundColor: c.bg }}>{body}</View>
        ) : (
          <ImageBackground source={BG_LIGHT} resizeMode="cover" style={{ flex: 1, backgroundColor: c.bg }}>
            {body}
          </ImageBackground>
        )}
        {ready && splash && (
          <Splash bg={c.bg} wordmark={WORDMARK[settings.theme] || WORDMARK.dark} hint={c.faint} onDone={() => setSplash(false)} />
        )}
      </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  wordmark: { width: 66, height: 46 },
  nav: { flex: 1, flexDirection: 'row', borderRadius: 999, borderWidth: 1, padding: 3, marginLeft: 6 },
  tab: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 999 },
  notice: { marginHorizontal: 16, marginBottom: 10, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 90,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
});

# ChatTalk — speak, record, translate

Records speech and shows it line by line with its translation. Twenty languages are available (choose yours in Settings); by default Mandarin, Cantonese, Malay, Vietnamese,
Indonesian and English, translated in any direction between Mandarin, Indonesian, Malay, Vietnamese and English
(pinyin shown whenever Chinese is on either side). The phone web page has a language switcher with
a swap button for two-way conversations. The Android app in `mobile/` has the same features as the web app. A small Python server does the AI work.

```
phone: record (16 kHz mono m4a) ──upload──▶ server: speech-to-text (Whisper)
                                                   → simplified/traditional + pinyin
                                                   → Claude translation with context
phone: line-by-line view ◀──── segments JSON ──────┘
```

## What it does now (v0.1, record-then-translate)
- Record up to 90 minutes, with a live level meter
- Transcribe Mandarin (or Cantonese) and translate every line to English
- Simplified or Traditional characters, optional pinyin
- Tap any line to replay that part of the audio
- Long-press a line to fix misheard Chinese, then re-translate just that line
- Glossary for names and terms (improves both recognition and translation)
- Natural or literal translation style
- History of recordings saved on the phone; share a transcript as text

## Quickest way: free, online, used from your phone's browser

The server includes a phone recording page at `/`, so once it's hosted you don't need a computer
or the Expo app at all. With Groq's free plan it costs nothing: Groq runs Whisper large-v3 for
speech recognition and an open model for translation, with one free API key (no card).

1. Get a free **Groq API key** at console.groq.com → API Keys.
2. Put this project in a GitHub repository.
3. On **render.com**: New → Blueprint → choose the repository. Fill in `GROQ_API_KEY` and
   `API_TOKEN` (any access code you make up). Deploy.
4. Open the `https://….onrender.com` address on your phone, enter the access code in Settings,
   and add the page to your home screen.

Free-plan limits (Groq's, checked October 2026; confirm in your Groq console): about 2 hours of audio
per hour and 8 hours per day for Whisper, and 200K translation tokens per day. Render's free plan sleeps
when unused, so the first request after a break can take about a minute.

**Free backup for translation:** add `GEMINI_API_KEY` (from aistudio.google.com, free tier) on Render. Groq stays first;
when its translation allowance runs out (or it's busy for a minute), the server uses Gemini instead and goes back to Groq later.
Speech-to-text stays on Groq either way (its 8 hours/day allowance is separate).

To use Claude for translation instead (paid, best quality), add `ANTHROPIC_API_KEY` on Render; the server
switches to it automatically and keeps Groq for Whisper.



## Live mode (web app)

Two bubbles at the bottom of the Record page:

- **Live subtitles**: listens continuously and shows each sentence with its translation a few seconds later
  (Spoken → Translate into, as chosen above).
- **Live conversation**: the two chosen languages form a pair; each sentence's language is detected
  (Whisper language ID, with Indonesian and Malay treated as one family) and translated into the other one.

The page captures 16 kHz audio, cuts it at pauses (3–12 s chunks), and calls
`POST /api/live/transcribe` per chunk and `POST /api/live/translate` for batches of lines, so lines appear
immediately and translations catch up. Stopping saves the session (full audio, per-line languages, AI title
from `POST /api/title`) to History.

## Android app (records with the screen off)

The `mobile/` folder is a native Android app (Expo / React Native) with the same languages, titles
and history as the web page, plus recording that keeps going when the phone is locked.
GitHub builds it automatically (`.github/workflows/android.yml`) whenever `mobile/` changes.

- **Install:** on your phone open
  `https://github.com/ryryry-droid/tingyi/releases/latest/download/tingyi.apk`, then allow installing from your browser.
- **First-time setup for builds:** add a repository secret `KEYSTORE_PASSWORD` (a long passphrase you keep).
  The first build creates the app's signing key, encrypted with it, so updates install over each other.
  If you lose the passphrase, delete `mobile/signing/` and uninstall the app before installing a new build.
- In the app's Settings, enter your Render address and access code.

## 1. Run the server on your computer

Needs Python 3.10+, an Anthropic API key, and an OpenAI API key (for Whisper speech recognition).

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then put your keys in .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Check it at `http://localhost:8000/health`. Tests (no keys needed): `python -m pytest -q`.

**Keep audio off the cloud:** set `ASR_PROVIDER=local` and `pip install faster-whisper` to run Whisper
on your own machine instead (a GPU makes it much faster). Only the Chinese text is then sent out for translation.

## 2. Run the app

Needs Node 20+ and the **Expo Go** app on your phone (or an iOS simulator / Android emulator).

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with your phone. Then in the app open **Settings** and set the server address to
your computer's local IP, e.g. `http://192.168.1.23:8000` (find it with `ipconfig` / `ifconfig`; the phone
and computer must be on the same Wi-Fi). Tap **Test connection**.

## Project layout

```
backend/app/
  asr.py         speech recognition (OpenAI Whisper API or local faster-whisper)
  textproc.py    script conversion (OpenCC) and pinyin
  translate.py   Claude translation, batched, carrying previous lines as context
  pipeline.py    glues the steps together
  main.py        HTTP API: POST /api/translate, POST /api/retranslate, GET /health
mobile/
  App.tsx                     app state and navigation
  src/screens/HomeScreen      recorder + history
  src/screens/SessionScreen   line-by-line results, replay, edit
  src/screens/SettingsScreen  server, language, script, style, glossary
  src/api.ts, storage.ts      server calls and on-device storage
```

## Adding live translation next

The server is already split into per-chunk steps so live mode can reuse them:

1. **App:** record in short chunks (or stream PCM) and cut at pauses using the recorder's metering level.
2. **Server:** add a WebSocket endpoint, e.g. `/ws/live`. For each chunk: `asr.transcribe` →
   `pipeline.clean_segments(start_id=next_id)` → `translate.translate_lines(new, context=last_few_lines)`,
   then push the new lines back.
3. **UI:** show the incoming Chinese immediately in grey, then fill in the English when it arrives.
   For lower latency, switch ASR to a streaming provider (e.g. Alibaba Paraformer realtime,
   Azure, or Google streaming recognition).

## Before shipping to real users
- Host the server somewhere with HTTPS (Render, Fly.io, Railway, a VPS) and set `API_TOKEN`.
  Never put your API keys inside the app.
- Building store apps: `npx expo prebuild` or EAS Build. Replace `com.example.tingyi` in `app.json`.
- If you build a standalone Android app and keep a plain `http://` server address, allow cleartext traffic
  (or just use HTTPS).
- Recordings of other people are personal data: tell users, get consent, and consider an auto-delete option.

Model names (`whisper-1`, `claude-sonnet-5-5`) are set in `backend/.env`; check current models and
prices from each provider before deploying.

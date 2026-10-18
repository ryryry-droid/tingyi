"""API tests with the speech and translation providers faked out (no keys needed).

Run from the backend folder:  python -m pytest -q
"""
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import asr, config, translate
from app.main import app
from app.models import RawSegment

client = TestClient(app)


def fake_transcribe(path, opts):
    return [
        RawSegment(start=0.0, end=2.1, text="你好，我是王小明。"),
        RawSegment(start=2.1, end=4.8, text="昨天去了醫院。"),  # traditional chars mixed in
    ], 4.8


class FakeAnthropic:
    def __init__(self):
        self.prompts = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        prompt = kwargs["messages"][0]["content"]
        self.prompts.append(prompt)
        if "Write a short title" in prompt:
            return SimpleNamespace(content=[SimpleNamespace(type="text", text='{"title": "Meeting Wang Xiaoming."}')])
        lines = json.loads(prompt.split("Translate these lines:\n", 1)[1])
        out = {"translations": [{"id": l["id"], "en": f"EN<{l['text']}>"} for l in lines]}
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="```json\n" + json.dumps(out) + "\n```")])


def setup(monkeypatch):
    fake = FakeAnthropic()
    monkeypatch.setattr(asr, "transcribe", fake_transcribe)
    monkeypatch.setattr(translate, "_client", lambda: fake)
    monkeypatch.setattr(config, "API_TOKEN", "")
    return fake


def test_translate_recording(monkeypatch):
    fake = setup(monkeypatch)
    opts = {"script": "simplified", "pinyin": True, "glossary": ["王小明 = Wang Xiaoming"]}
    r = client.post("/api/translate", files={"file": ("a.m4a", b"fake-audio", "audio/m4a")},
                    data={"options": json.dumps(opts)})
    assert r.status_code == 200, r.text
    body = r.json()
    segs = body["segments"]
    assert body["duration"] == 4.8 and len(segs) == 2
    assert segs[1]["zh"] == "昨天去了医院。"  # converted to simplified
    assert segs[0]["pinyin"].startswith("nǐ hǎo")
    assert segs[0]["en"] == "EN<你好，我是王小明。>"
    assert "Wang Xiaoming" in fake.prompts[0]  # glossary reached the translator


def test_batches_carry_context(monkeypatch):
    fake = setup(monkeypatch)
    monkeypatch.setattr(config, "TRANSLATE_BATCH_SIZE", 1)
    r = client.post("/api/translate", files={"file": ("a.m4a", b"x", "audio/m4a")}, data={"options": "{}"})
    assert r.status_code == 200
    fake.prompts = [p for p in fake.prompts if "Write a short title" not in p]
    assert len(fake.prompts) == 2
    assert "Context (already translated" in fake.prompts[1] and "我是王小明" in fake.prompts[1]


def test_traditional_and_no_pinyin(monkeypatch):
    setup(monkeypatch)
    r = client.post("/api/translate", files={"file": ("a.m4a", b"x", "audio/m4a")},
                    data={"options": json.dumps({"script": "traditional", "pinyin": False})})
    seg = r.json()["segments"][1]
    assert seg["zh"] == "昨天去了醫院。" and seg["pinyin"] is None


def test_retranslate(monkeypatch):
    setup(monkeypatch)
    r = client.post("/api/retranslate", json={"zh": "我们走吧", "context": [
        {"id": 0, "start": 0, "end": 1, "zh": "你好", "en": "Hello"}]})
    assert r.status_code == 200
    assert r.json()["en"] == "EN<我们走吧>"


def test_token_required(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(config, "API_TOKEN", "secret")
    r = client.post("/api/translate", files={"file": ("a.m4a", b"x", "audio/m4a")})
    assert r.status_code == 401
    r = client.post("/api/translate", files={"file": ("a.m4a", b"x", "audio/m4a")},
                    headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200


def test_empty_upload(monkeypatch):
    setup(monkeypatch)
    r = client.post("/api/translate", files={"file": ("a.m4a", b"", "audio/m4a")})
    assert r.status_code == 400


def test_web_app_served(monkeypatch):
    setup(monkeypatch)
    r = client.get("/")
    assert r.status_code == 200 and "ChatTalk" in r.text and "MediaRecorder" in r.text
    assert client.get("/manifest.webmanifest").status_code == 200
    assert client.get("/icon-192.png").headers["content-type"] == "image/png"
    assert client.get("/health").json()["token_required"] is False


def test_unknown_extension_defaults(monkeypatch):
    seen = {}
    setup(monkeypatch)
    monkeypatch.setattr(asr, "transcribe", lambda path, opts: (seen.setdefault("p", path), fake_transcribe(path, opts))[1])
    r = client.post("/api/translate", files={"file": ("x.exe", b"x", "audio/webm")})
    assert r.status_code == 200 and seen["p"].endswith(".m4a")


def test_groq_style_translator(monkeypatch):
    """TRANSLATE_PROVIDER=openai path (used for Groq's free plan)."""
    calls = []

    class FakeOpenAI:
        def __init__(self):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            calls.append(kwargs)
            if "Write a short title" in kwargs["messages"][-1]["content"]:
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"title": "Hi"}'))])
            prompt = kwargs["messages"][1]["content"]
            lines = json.loads(prompt.split("Translate these lines:\n", 1)[1])
            out = {"translations": [{"id": l["id"], "en": f"G<{l['text']}>"} for l in lines]}
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(out)))])

    setup(monkeypatch)
    monkeypatch.setattr(config, "TRANSLATE_PROVIDER", "openai")
    monkeypatch.setattr(config, "OPENAI_TRANSLATE_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(translate, "_openai_client", lambda: FakeOpenAI())
    r = client.post("/api/translate", files={"file": ("a.webm", b"x", "audio/webm")}, data={"options": "{}"})
    assert r.status_code == 200, r.text
    assert r.json()["segments"][0]["en"] == "G<你好，我是王小明。>"
    assert calls[0]["reasoning_effort"] == "low" and calls[0]["response_format"] == {"type": "json_object"}


def test_indonesian_to_english(monkeypatch):
    fake = setup(monkeypatch)
    seen = {}

    def fake_id(path, opts):
        seen["source"] = opts.source
        return [RawSegment(start=0, end=2, text="Udah makan belum?"),
                RawSegment(start=2, end=3, text="Terima kasih telah menonton")], 3.0

    monkeypatch.setattr(asr, "transcribe", fake_id)
    r = client.post("/api/translate", files={"file": ("a.webm", b"x", "audio/webm")},
                    data={"options": json.dumps({"source": "id", "target": "en", "pinyin": True})})
    body = r.json()
    assert r.status_code == 200 and seen["source"] == "id" and body["source"] == "id"
    seg = body["segments"][0]
    assert seg["text"] == "Udah makan belum?" and seg["pinyin"] is None  # no pinyin for Indonesian
    assert seg["translation"] == "EN<Udah makan belum?>"
    assert "from Indonesian" in fake.prompts[0] and "sih, dong" in fake.prompts[0]


def test_english_to_mandarin_gets_pinyin(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(asr, "transcribe", lambda p, o: ([RawSegment(start=0, end=1, text="Hello")], 1.0))
    monkeypatch.setattr(translate, "translate_lines", lambda lines, ctx, opts: {l.id: "醫院在哪裡？" for l in lines})
    monkeypatch.setattr("app.pipeline.translate.translate_lines", translate.translate_lines)
    r = client.post("/api/translate", files={"file": ("a.webm", b"x", "audio/webm")},
                    data={"options": json.dumps({"source": "en", "target": "zh", "script": "simplified"})})
    seg = r.json()["segments"][0]
    assert seg["translation"] == "医院在哪里？"  # forced to simplified
    assert seg["translation_pinyin"].startswith("yī yuàn")


def test_retranslate_indonesian_target(monkeypatch):
    fake = setup(monkeypatch)
    r = client.post("/api/retranslate", json={"text": "你好", "options": {"source": "zh", "target": "id"}})
    assert r.status_code == 200 and r.json()["translation"] == "EN<你好>"
    assert "into Indonesian" in fake.prompts[0]


def test_hallucination_filter():
    assert not asr._keep("Terima kasih telah menonton!")
    assert not asr._keep("谢谢观看")
    assert not asr._keep("Hmm", no_speech_prob=0.9, avg_logprob=-1.5)
    assert asr._keep("Terima kasih banyak ya")


def test_summary_title(monkeypatch):
    fake = setup(monkeypatch)
    r = client.post("/api/translate", files={"file": ("a.m4a", b"x", "audio/m4a")}, data={"options": "{}"})
    assert r.json()["title"] == "Meeting Wang Xiaoming"  # trailing punctuation removed
    title_prompt = [p for p in fake.prompts if "Write a short title" in p][0]
    assert "in English" in title_prompt and "EN<你好，我是王小明。>" in title_prompt


def test_title_failure_is_harmless(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(translate, "_complete_simple", lambda p: (_ for _ in ()).throw(RuntimeError("rate limited")))
    r = client.post("/api/translate", files={"file": ("a.m4a", b"x", "audio/m4a")}, data={"options": "{}"})
    assert r.status_code == 200 and r.json()["title"] == ""


def test_lookup_chinese(monkeypatch):
    setup(monkeypatch)
    calls = []

    def fake(prompt, max_tokens=200):
        calls.append(prompt)
        return json.dumps({"word": "醫院", "root": "x", "part_of_speech": "noun", "meaning": "hospital",
                           "in_context": "the hospital nearby", "notes": "",
                           "example": {"text": "我去醫院看病。", "translation": "I'm going to the hospital to see a doctor."}})

    monkeypatch.setattr(translate, "_complete_simple", fake)
    r = client.post("/api/lookup", json={"word": "医院", "sentence": "最近的医院在哪里？", "lang": "zh", "script": "simplified"})
    body = r.json()
    assert r.status_code == 200, body
    assert body["word"] == "医院" and body["pinyin"] == "yī yuàn" and body["root"] == ""
    assert body["example"]["text"] == "我去医院看病。" and body["example"]["pinyin"].startswith("wǒ qù yī yuàn")
    assert "最近的医院在哪里" in calls[0] and "Simplified" in calls[0]


def test_lookup_indonesian_root(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(translate, "_complete_simple", lambda p, max_tokens=200: '{"word": "dimakan", "root": "makan", '
                        '"part_of_speech": "verb", "meaning": "eaten", "in_context": "was eaten", "notes": "",'
                        ' "example": {"text": "Kuenya sudah dimakan.", "translation": "The cake has been eaten."}}')
    r = client.post("/api/lookup", json={"word": "dimakan", "sentence": "Nasinya udah dimakan.", "lang": "id"})
    body = r.json()
    assert body["root"] == "makan" and body["pinyin"] is None and body["example"]["pinyin"] is None


def test_lookup_requires_token(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(config, "API_TOKEN", "secret")
    assert client.post("/api/lookup", json={"word": "a", "lang": "id"}).status_code == 401


def test_live_transcribe_subtitles(monkeypatch):
    setup(monkeypatch)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"RIFFxxxx", "audio/wav")},
                    data={"options": json.dumps({"source": "zh", "target": "en"}), "offset": "12.5"})
    segs = r.json()["segments"]
    assert r.status_code == 200 and segs[0]["start"] == 12.5 and segs[1]["start"] == 14.6
    assert segs[1]["text"] == "昨天去了医院。" and segs[0]["lang"] == "zh" and segs[0]["target"] == "en"
    assert segs[0]["pinyin"].startswith("nǐ hǎo")


def _fake_run(detected, text):
    calls = []
    def run(path, language, prompt):
        calls.append(language)
        t = text if language is None else f"{text}"
        return [RawSegment(start=0, end=1, text=t)], 1.0, detected
    return run, calls


def test_live_detect_picks_pair_language(monkeypatch):
    setup(monkeypatch)
    run, calls = _fake_run("english", "Where is the station?")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "zh", "target": "en"}), "detect": "true"})
    seg = r.json()["segments"][0]
    assert seg["lang"] == "en" and seg["target"] == "zh" and seg["pinyin"] is None and calls == [None]


def test_live_detect_malay_counts_as_indonesian(monkeypatch):
    setup(monkeypatch)
    run, calls = _fake_run("malay", "Mau ke mana?")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "zh", "target": "id"}), "detect": "true"})
    seg = r.json()["segments"][0]
    assert seg["lang"] == "id" and seg["target"] == "zh" and calls == [None]


def test_live_detect_outside_pair_retranscribes(monkeypatch):
    setup(monkeypatch)
    run, calls = _fake_run("japanese", "你好吗")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "en", "target": "zh"}), "detect": "true"})
    seg = r.json()["segments"][0]
    assert seg["lang"] == "zh" and seg["target"] == "en" and calls == [None, "zh"]


def test_live_translate_batch(monkeypatch):
    fake = setup(monkeypatch)
    r = client.post("/api/live/translate", json={
        "lines": [{"id": 7, "text": "你好"}, {"id": 8, "text": "谢谢"}],
        "context": [{"text": "早上好", "translation": "Good morning"}],
        "options": {"source": "zh", "target": "id"}})
    t = r.json()["translations"]
    assert r.status_code == 200 and [x["id"] for x in t] == [7, 8] and t[1]["translation"] == "EN<谢谢>"
    assert "早上好 => Good morning" in fake.prompts[0] and "into Indonesian" in fake.prompts[0]


def test_live_translate_into_chinese_adds_pinyin(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(translate, "translate_lines", lambda lines, ctx, opts: {l.id: "車站在哪裡？" for l in lines})
    r = client.post("/api/live/translate", json={"lines": [{"id": 1, "text": "Where is the station?"}],
                                                  "options": {"source": "en", "target": "zh", "script": "simplified"}})
    t = r.json()["translations"][0]
    assert t["translation"] == "车站在哪里？" and t["translation_pinyin"].startswith("chē zhàn")


def test_title_endpoint(monkeypatch):
    setup(monkeypatch)
    r = client.post("/api/title", json={"lines": [{"text": "你好", "translation": "Hello"}], "options": {}})
    assert r.json()["title"] == "Meeting Wang Xiaoming"


def test_prompt_echo_filtered():
    assert not asr._keep("请加上标点符号。")
    assert not asr._keep("以下是普通话的句子，请加上标点符号。")
    assert not asr._keep("Berikut adalah percakapan dalam bahasa Indonesia, dengan tanda baca yang benar.")
    assert asr._keep("请加上你的名字。")

"""API tests with the speech and translation providers faked out (no keys needed).

Run from the backend folder:  python -m pytest -q
"""
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import asr, config, models, translate
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

    def fake(prompt, max_tokens=200, **kw):
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
    monkeypatch.setattr(translate, "_complete_simple", lambda p, max_tokens=200, **kw: '{"word": "dimakan", "root": "makan", '
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


def test_malay_and_vietnamese_detection(monkeypatch):
    setup(monkeypatch)
    # pair Malay <-> Chinese: "malay" stays Malay
    run, calls = _fake_run("malay", "Nak pergi mana?")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "zh", "target": "ms"}), "detect": "true"})
    assert r.json()["segments"][0]["lang"] == "ms" and r.json()["segments"][0]["target"] == "zh"
    # pair Indonesian <-> English: Whisper saying "malay" counts as Indonesian
    run, calls = _fake_run("malay", "Mau ke mana?")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "id", "target": "en"}), "detect": "true"})
    assert r.json()["segments"][0]["lang"] == "id" and calls == [None]
    # Vietnamese
    run, calls = _fake_run("vietnamese", "Cảm ơn bạn")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "vi", "target": "en"}), "detect": "true"})
    assert r.json()["segments"][0]["lang"] == "vi" and r.json()["segments"][0]["target"] == "en"


def test_vietnamese_and_malay_translation_prompts(monkeypatch):
    fake = setup(monkeypatch)
    client.post("/api/retranslate", json={"text": "Cảm ơn anh nhé", "options": {"source": "vi", "target": "ms"}})
    assert "from Vietnamese into Malay" in fake.prompts[0] and "nhé" in fake.prompts[0]


def test_lookup_malay_root(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(translate, "_complete_simple", lambda p, max_tokens=200, **kw: '{"word": "makanan", "root": "makan", "meaning": "food"}')
    r = client.post("/api/lookup", json={"word": "makanan", "lang": "ms"})
    assert r.status_code == 200 and r.json()["root"] == "makan"


def test_new_language_hallucinations():
    assert not asr._keep("Terima kasih kerana menonton!")
    assert not asr._keep("Cảm ơn các bạn đã theo dõi")
    assert asr._keep("Cảm ơn bạn nhiều")


def test_extra_languages(monkeypatch):
    fake = setup(monkeypatch)
    client.post("/api/retranslate", json={"text": "ありがとう", "options": {"source": "ja", "target": "th"}})
    assert "from Japanese into Thai" in fake.prompts[0] and "Write natural, everyday Thai" in fake.prompts[0]
    # Japanese gets no Whisper hint (so it isn't nudged toward another language), only glossary terms
    assert asr._prompt(models.Options(source="ja", target="en")) == ""
    assert asr._prompt(models.Options(source="ko", target="en", glossary=["서울 = Seoul"])) == "서울"
    # conversation detection works for any language in the pair
    run, calls = _fake_run("korean", "안녕하세요")
    monkeypatch.setattr(asr, "_run", run)
    r = client.post("/api/live/transcribe", files={"file": ("c.wav", b"x", "audio/wav")},
                    data={"options": json.dumps({"source": "en", "target": "ko"}), "detect": "true"})
    assert r.json()["segments"][0]["lang"] == "ko" and r.json()["segments"][0]["target"] == "en"
    monkeypatch.setattr(translate, "_complete_simple", lambda p, max_tokens=200, **kw: '{"word": "hola", "meaning": "hello"}')
    assert client.post("/api/lookup", json={"word": "hola", "lang": "es"}).json()["meaning"] == "hello"


def test_lookup_from_english(monkeypatch):
    setup(monkeypatch)
    seen = []

    def fake(prompt, max_tokens=200, **kw):
        seen.append(prompt)
        return '{"word": "周末", "part_of_speech": "noun", "meaning": "weekend", "example": {"text": "周末愉快", "translation": "Have a nice weekend"}}'

    monkeypatch.setattr(translate, "_complete_simple", fake)
    r = client.post("/api/lookup", json={"word": "weekend", "lang": "zh", "from_english": True})
    assert r.status_code == 200 and r.json()["word"] == "周末" and r.json()["pinyin"]
    assert 'how to say the English word or phrase "weekend" in Mandarin' in seen[0] and "not the English one" in seen[0]


def test_colloquial_register(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(translate, "_complete_simple", lambda p, max_tokens=200, **kw: '{"word": "gak", "register": "colloquial", "standard": "tidak", "meaning": "no, not"}')
    r = client.post("/api/lookup", json={"word": "gak", "lang": "id"}).json()
    assert r["register"] == "colloquial" and r["standard"] == "tidak"
    monkeypatch.setattr(translate, "_complete_simple", lambda p, max_tokens=200, **kw: '{"words": [{"word": "gak", "register": "colloquial", "standard": "tidak"}, {"word": "makan", "register": "standard"}]}')
    r = client.post("/api/register", json={"lang": "id", "words": ["gak", "makan", "banget"]}).json()["results"]
    assert r == [
        {"word": "gak", "register": "colloquial", "standard": "tidak"},
        {"word": "makan", "register": "standard", "standard": ""},
        {"word": "banget", "register": "standard", "standard": ""},
    ]


def test_redo_one_line(monkeypatch, tmp_path):
    import av
    import numpy as np

    fake = setup(monkeypatch)
    heard = {}

    def one_line(path, opts):
        import wave

        with wave.open(path) as w:
            heard["seconds"] = w.getnframes() / w.getframerate()
        return [RawSegment(start=0, end=2, text="我们周末去公园吧。")], 2.0

    monkeypatch.setattr(asr, "transcribe", one_line)
    # a real 8-second recording to cut from
    path = tmp_path / "rec.m4a"
    out = av.open(str(path), "w")
    st = out.add_stream("aac", rate=16000)
    st.layout = "mono"
    sig = (0.3 * np.sin(np.arange(16000 * 8) / 16000 * 2 * np.pi * 300)).astype(np.float32)
    for i in range(0, len(sig), 1024):
        chunk = np.pad(sig[i : i + 1024], (0, max(0, 1024 - len(sig[i : i + 1024]))))
        fr = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format="flt", layout="mono")
        fr.sample_rate, fr.pts = 16000, i
        for pk in st.encode(fr):
            out.mux(pk)
    for pk in st.encode(None):
        out.mux(pk)
    out.close()
    r = client.post(
        "/api/redo",
        files={"file": ("rec.m4a", path.read_bytes(), "audio/mp4")},
        data={"options": json.dumps({"source": "zh", "target": "en"}), "start": "3", "end": "5",
              "context": json.dumps([{"text": "你好", "translation": "Hello"}])},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"] == "我们周末去公园吧。" and body["translation"] == "EN<我们周末去公园吧。>"
    assert body["pinyin"].startswith("wǒ men")
    assert 2.5 < heard["seconds"] < 3.0  # just that line, plus a little padding
    assert any("Hello" in p for p in fake.prompts)  # earlier lines were given as context
    assert any("misheard words" in p for p in fake.prompts)  # Redo checks for mishearings first


def test_lookup_flags_words_that_dont_exist(monkeypatch):
    setup(monkeypatch)
    calls = []

    def fake(prompt, max_tokens=200, **kw):
        calls.append((prompt, kw.get("effort")))
        if len(calls) == 1:  # first pass is fooled and invents a meaning
            return '{"word": "terlekar", "meaning": "abandoned", "exists": true, "example": {"text": "Rumah itu terlekar.", "translation": "The house is abandoned."}}'
        return '{"word": "terlekar", "exists": false, "meaning": "", "suggestions": ["terlantar", "tergeletak"]}'

    monkeypatch.setattr(translate, "_complete_simple", fake)
    r = client.post("/api/lookup", json={"word": "terlekar", "sentence": "Rumahnya terlekar.", "lang": "id", "strict": True}).json()
    assert r["exists"] is False and r["meaning"] == "" and r["example"] is None
    assert r["suggestions"] == ["terlantar", "tergeletak"]
    assert len(calls) == 2 and "for a Indonesian–English" in calls[1][0] and calls[0][1] == "medium"
    assert "Never invent a meaning" in calls[0][0]



def test_lookup_strict_by_default(monkeypatch):
    setup(monkeypatch)
    calls = []

    def fake(prompt, max_tokens=200, **kw):
        calls.append(kw.get("effort", "low"))
        return '{"word": "makan", "meaning": "to eat", "exists": true}'

    monkeypatch.setattr(translate, "_complete_simple", fake)
    r = client.post("/api/lookup", json={"word": "makan", "lang": "id", "strict": False}).json()
    assert r["meaning"] == "to eat" and calls == ["low"]  # strict=False: one quick call, no second check
    calls.clear()
    client.post("/api/lookup", json={"word": "makan", "lang": "id"})
    assert calls == ["medium", "medium"]  # by default every lookup is thorough and double-checked

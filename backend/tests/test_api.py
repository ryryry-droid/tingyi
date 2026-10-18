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
        lines = json.loads(prompt.split("Translate these lines:\n", 1)[1])
        out = {"translations": [{"id": l["id"], "en": f"EN<{l['zh']}>"} for l in lines]}
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
    assert r.status_code == 200 and "听译" in r.text and "MediaRecorder" in r.text
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
            prompt = kwargs["messages"][1]["content"]
            lines = json.loads(prompt.split("Translate these lines:\n", 1)[1])
            out = {"translations": [{"id": l["id"], "en": f"G<{l['zh']}>"} for l in lines]}
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(out)))])

    setup(monkeypatch)
    monkeypatch.setattr(config, "TRANSLATE_PROVIDER", "openai")
    monkeypatch.setattr(config, "OPENAI_TRANSLATE_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(translate, "_openai_client", lambda: FakeOpenAI())
    r = client.post("/api/translate", files={"file": ("a.webm", b"x", "audio/webm")}, data={"options": "{}"})
    assert r.status_code == 200, r.text
    assert r.json()["segments"][0]["en"] == "G<你好，我是王小明。>"
    assert calls[0]["reasoning_effort"] == "low" and calls[0]["response_format"] == {"type": "json_object"}

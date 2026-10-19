"""Settings read from environment variables (see .env.example).

Free setup: set only GROQ_API_KEY. Groq then does both steps:
Whisper large-v3 for speech recognition and an open model for translation.
"""
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


GROQ_API_KEY = _env("GROQ_API_KEY")
_GROQ = bool(GROQ_API_KEY)

# ---- Speech recognition: "openai" = any OpenAI-compatible Whisper API (Groq or OpenAI),
#      "local" = faster-whisper on this machine
ASR_PROVIDER = _env("ASR_PROVIDER", "openai")
OPENAI_BASE_URL = _env("OPENAI_BASE_URL") or ("https://api.groq.com/openai/v1" if _GROQ else None)
OPENAI_API_KEY = GROQ_API_KEY or _env("OPENAI_API_KEY")
OPENAI_TRANSCRIBE_MODEL = _env("OPENAI_TRANSCRIBE_MODEL", "whisper-large-v3" if _GROQ else "whisper-1")
LOCAL_WHISPER_MODEL = _env("LOCAL_WHISPER_MODEL", "large-v3")

# ---- Translation (and word lookups, titles, Redo): "anthropic" (Claude) or "openai" (any OpenAI-compatible
#      chat API: Groq, Google Gemini, OpenAI...). Claude is used if its key is set; otherwise Groq first, and
#      Gemini as an automatic backup for when Groq's free daily allowance runs out.
_HAS_ANTHROPIC = bool(_env("ANTHROPIC_API_KEY"))
GEMINI_API_KEY = _env("GEMINI_API_KEY")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GEMINI_MODEL = _env("GEMINI_MODEL", "gemini-3.8-flash")  # free on Google AI Studio's free tier
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_TRANSLATE_MODEL = _env("TRANSLATE_MODEL", "openai/gpt-oss-120b")
TRANSLATE_PROVIDER = _env(
    "TRANSLATE_PROVIDER", "anthropic" if _HAS_ANTHROPIC or not (_GROQ or GEMINI_API_KEY) else "openai"
)
ANTHROPIC_MODEL = _env("ANTHROPIC_MODEL", "claude-sonnet-5-5")

# OpenAI-compatible chat services to use, in order: if one hits its (free-plan) limit, the next is tried.
# Each entry: (name, base_url, api_key, model)
CHAT_SERVICES: list[tuple[str, str | None, str, str]] = []
if _GROQ:
    CHAT_SERVICES.append(("groq", GROQ_BASE_URL, GROQ_API_KEY, GROQ_TRANSLATE_MODEL))
if GEMINI_API_KEY:
    CHAT_SERVICES.append(("gemini", GEMINI_BASE_URL, GEMINI_API_KEY, GEMINI_MODEL))
if not CHAT_SERVICES:  # plain OpenAI (or another compatible API set with OPENAI_BASE_URL)
    CHAT_SERVICES.append(("openai", _env("OPENAI_BASE_URL") or None, _env("OPENAI_API_KEY"), _env("TRANSLATE_MODEL", "gpt-4.1-mini")))
# Set to a service name (e.g. "gemini") to send in-depth checks (word lookups, Redo) there first.
# Empty (default): everything uses the services in order — Groq, with Gemini only as the backup.
CAREFUL_SERVICE = _env("CAREFUL_SERVICE", "")
OPENAI_TRANSLATE_MODEL = CHAT_SERVICES[0][3]
TRANSLATE_MODEL = ANTHROPIC_MODEL if TRANSLATE_PROVIDER == "anthropic" else " → ".join(s[3] for s in CHAT_SERVICES)

# Smaller batches keep each request under free-plan per-minute token limits
TRANSLATE_BATCH_SIZE = int(_env("TRANSLATE_BATCH_SIZE", "40" if TRANSLATE_PROVIDER == "anthropic" else "20"))
CONTEXT_SEGMENTS = int(_env("CONTEXT_SEGMENTS", "6"))

# Shared secret the app must send as "Authorization: Bearer <token>" (strongly recommended when hosted)
API_TOKEN = _env("API_TOKEN")

MAX_UPLOAD_MB = int(_env("MAX_UPLOAD_MB", "25"))

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

# ---- Translation: "anthropic" (Claude) or "openai" (any OpenAI-compatible chat API, e.g. Groq)
_HAS_ANTHROPIC = bool(_env("ANTHROPIC_API_KEY"))
TRANSLATE_PROVIDER = _env("TRANSLATE_PROVIDER", "anthropic" if _HAS_ANTHROPIC or not _GROQ else "openai")
ANTHROPIC_MODEL = _env("ANTHROPIC_MODEL", "claude-sonnet-5-5")
# On Groq's free plan, qwen/qwen3.8-27b is also strong at Chinese but is a preview model.
OPENAI_TRANSLATE_MODEL = _env("TRANSLATE_MODEL", "openai/gpt-oss-120b" if _GROQ else "gpt-4.1-mini")
TRANSLATE_MODEL = ANTHROPIC_MODEL if TRANSLATE_PROVIDER == "anthropic" else OPENAI_TRANSLATE_MODEL

# Smaller batches keep each request under free-plan per-minute token limits
TRANSLATE_BATCH_SIZE = int(_env("TRANSLATE_BATCH_SIZE", "40" if TRANSLATE_PROVIDER == "anthropic" else "20"))
CONTEXT_SEGMENTS = int(_env("CONTEXT_SEGMENTS", "6"))

# Shared secret the app must send as "Authorization: Bearer <token>" (strongly recommended when hosted)
API_TOKEN = _env("API_TOKEN")

MAX_UPLOAD_MB = int(_env("MAX_UPLOAD_MB", "25"))

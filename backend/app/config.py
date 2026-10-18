"""Settings read from environment variables (see .env.example)."""
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


# Speech recognition: "openai" (cloud, default) or "local" (faster-whisper on this machine)
ASR_PROVIDER = _env("ASR_PROVIDER", "openai")
OPENAI_TRANSCRIBE_MODEL = _env("OPENAI_TRANSCRIBE_MODEL", "whisper-1")
# Any OpenAI-compatible Whisper service works; e.g. Groq:
#   OPENAI_BASE_URL=https://api.groq.com/openai/v1  OPENAI_TRANSCRIBE_MODEL=whisper-large-v3
OPENAI_BASE_URL = _env("OPENAI_BASE_URL") or None
LOCAL_WHISPER_MODEL = _env("LOCAL_WHISPER_MODEL", "large-v3")

# Translation (Claude)
ANTHROPIC_MODEL = _env("ANTHROPIC_MODEL", "claude-sonnet-5-5")
TRANSLATE_BATCH_SIZE = int(_env("TRANSLATE_BATCH_SIZE", "40"))
CONTEXT_SEGMENTS = int(_env("CONTEXT_SEGMENTS", "6"))

# Optional shared secret the app must send as "Authorization: Bearer <token>"
API_TOKEN = _env("API_TOKEN")

MAX_UPLOAD_MB = int(_env("MAX_UPLOAD_MB", "25"))

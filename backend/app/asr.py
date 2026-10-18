"""Speech recognition: audio file -> timestamped segments in the spoken language.

Every provider exposes the same function, so the pipeline (and the future live
mode, which will call it on short chunks) doesn't care which one is in use.
"""
import re
from functools import lru_cache

from . import config
from .models import Options, RawSegment

# Whisper language codes. Hosted APIs don't accept "yue", so Cantonese is sent as "zh" there.
_LANG = {"zh": "zh", "yue": "yue", "id": "id", "en": "en"}
_LANG_HOSTED = {"zh": "zh", "yue": "zh", "id": "id", "en": "en"}

# A short prompt in the spoken language nudges Whisper toward that language, the right
# script, and punctuated output; glossary terms are appended to bias recognition of names.
_PROMPT = {
    ("zh", "simplified"): "以下是普通话的句子，请加上标点符号。",
    ("zh", "traditional"): "以下是普通話的句子，請加上標點符號。",
    ("yue", "simplified"): "以下系广东话嘅句子，请加上标点符号。",
    ("yue", "traditional"): "以下係廣東話嘅句子，請加上標點符號。",
    ("id", None): "Berikut adalah percakapan dalam bahasa Indonesia, dengan tanda baca yang benar.",
    ("en", None): "The following is a conversation in English, with proper punctuation.",
}

# Phrases Whisper is known to invent over silence or music (it learned them from video subtitles)
_HALLUCINATIONS = re.compile(
    r"^(terima kasih (telah|sudah) menonton|jangan lupa (like|subscribe)|thanks? (you )?for watching|"
    r"please subscribe|subtitles? by|字幕|请不吝点赞|謝謝觀看|谢谢观看|明镜与点点栏目|优优独播剧场)",
    re.I,
)


def _prompt(opts: Options) -> str:
    key = (opts.source, opts.script if opts.source_is_chinese else None)
    prompt = _PROMPT[key]
    terms = [g.split("=")[0].strip() for g in opts.glossary if g.strip()]
    if terms:
        joiner = ("词汇：", "、", "。") if opts.source_is_chinese else (" Kosakata: " if opts.source == "id" else " Terms: ", ", ", ".")
        prompt += joiner[0] + joiner[1].join(terms[:50]) + joiner[2]
    return prompt


def _keep(text: str, no_speech_prob: float = 0.0, avg_logprob: float = 0.0) -> bool:
    text = text.strip()
    if not text:
        return False
    if no_speech_prob > 0.6 and avg_logprob < -1.0:  # probably silence or noise
        return False
    return not _HALLUCINATIONS.match(text)


def transcribe(path: str, opts: Options) -> tuple[list[RawSegment], float]:
    """Returns (segments, duration_seconds)."""
    if config.ASR_PROVIDER == "local":
        return _transcribe_local(path, opts)
    return _transcribe_openai(path, opts)


def _transcribe_openai(path: str, opts: Options) -> tuple[list[RawSegment], float]:
    from openai import OpenAI

    client = OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY or None, max_retries=4)
    args = dict(
        model=config.OPENAI_TRANSCRIBE_MODEL,
        language=_LANG_HOSTED[opts.source],
        prompt=_prompt(opts),
        response_format="verbose_json",
    )
    try:
        with open(path, "rb") as f:
            result = client.audio.transcriptions.create(file=f, timestamp_granularities=["segment"], **args)
    except Exception as e:
        if "timestamp" not in str(e).lower():
            raise
        with open(path, "rb") as f:  # provider without timestamp_granularities
            result = client.audio.transcriptions.create(file=f, **args)
    raw = result.model_dump() if hasattr(result, "model_dump") else dict(result)
    segments = [
        RawSegment(start=float(s["start"]), end=float(s["end"]), text=s["text"].strip())
        for s in raw.get("segments") or []
        if _keep(s.get("text", ""), float(s.get("no_speech_prob") or 0), float(s.get("avg_logprob") or 0))
    ]
    if not raw.get("segments") and _keep(raw.get("text", "")):  # model without segment timestamps
        segments = [RawSegment(start=0, end=float(raw.get("duration") or 0), text=raw["text"].strip())]
    duration = float(raw.get("duration") or (segments[-1].end if segments else 0))
    return segments, duration


@lru_cache(maxsize=1)
def _local_model():
    from faster_whisper import WhisperModel  # pip install faster-whisper

    return WhisperModel(config.LOCAL_WHISPER_MODEL, device="auto", compute_type="auto")


def _transcribe_local(path: str, opts: Options) -> tuple[list[RawSegment], float]:
    segments_iter, info = _local_model().transcribe(
        path,
        language=_LANG[opts.source],
        initial_prompt=_prompt(opts),
        vad_filter=True,  # skip silence
    )
    segments = [
        RawSegment(start=s.start, end=s.end, text=s.text.strip())
        for s in segments_iter
        if _keep(s.text, s.no_speech_prob, s.avg_logprob)
    ]
    return segments, float(info.duration)

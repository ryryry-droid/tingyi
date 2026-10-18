"""Speech recognition: audio file -> timestamped Chinese segments.

Every provider exposes the same function, so the pipeline (and the future live
mode, which will call it on short chunks) doesn't care which one is in use.
"""
from functools import lru_cache

from . import config
from .models import Options, RawSegment

# Whisper's language codes
_LANG = {"mandarin": "zh", "cantonese": "yue"}

# A short prompt in the target script nudges Whisper toward that script and
# toward punctuated output, and lets us bias it toward glossary terms.
_PROMPT = {
    "simplified": "以下是普通话的句子，请加上标点符号。",
    "traditional": "以下是普通話的句子，請加上標點符號。",
}


def _prompt(opts: Options) -> str:
    prompt = _PROMPT[opts.script]
    terms = [g.split("=")[0].strip() for g in opts.glossary if g.strip()]
    if terms:
        prompt += " 词汇：" + "、".join(terms[:50]) + "。"
    return prompt


def transcribe(path: str, opts: Options) -> tuple[list[RawSegment], float]:
    """Returns (segments, duration_seconds)."""
    if config.ASR_PROVIDER == "local":
        return _transcribe_local(path, opts)
    return _transcribe_openai(path, opts)


def _transcribe_openai(path: str, opts: Options) -> tuple[list[RawSegment], float]:
    from openai import OpenAI

    client = OpenAI(base_url=config.OPENAI_BASE_URL)
    # Hosted APIs only accept "zh" for Chinese; Cantonese still comes back as Chinese text.
    args = dict(
        model=config.OPENAI_TRANSCRIBE_MODEL,
        language="zh",
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
        if s.get("text", "").strip()
    ]
    if not segments and raw.get("text", "").strip():  # model without segment timestamps
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
        language=_LANG[opts.dialect],
        initial_prompt=_prompt(opts),
        vad_filter=True,  # skip silence
    )
    segments = [
        RawSegment(start=s.start, end=s.end, text=s.text.strip()) for s in segments_iter if s.text.strip()
    ]
    return segments, float(info.duration)

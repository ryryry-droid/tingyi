"""Speech recognition: audio file -> timestamped segments in the spoken language.

Every provider exposes the same function, so the pipeline (and the future live
mode, which will call it on short chunks) doesn't care which one is in use.
"""
import re
from functools import lru_cache

from . import config
from .models import LANG_NAMES, Options, RawSegment

# Whisper language codes. Hosted APIs don't accept "yue", so Cantonese is sent as "zh" there.
_LANG = {code: code for code in LANG_NAMES}
_LANG_HOSTED = {**_LANG, "yue": "zh"}

# A short prompt in the spoken language nudges Whisper toward that language, the right
# script, and punctuated output; glossary terms are appended to bias recognition of names.
_PROMPT = {
    ("zh", "simplified"): "以下是普通话的句子，请加上标点符号。",
    ("zh", "traditional"): "以下是普通話的句子，請加上標點符號。",
    ("yue", "simplified"): "以下系广东话嘅句子，请加上标点符号。",
    ("yue", "traditional"): "以下係廣東話嘅句子，請加上標點符號。",
    ("id", None): "Berikut adalah percakapan dalam bahasa Indonesia, dengan tanda baca yang benar.",
    ("ms", None): "Berikut ialah perbualan dalam bahasa Melayu, dengan tanda baca yang betul.",
    ("vi", None): "Sau đây là một cuộc hội thoại bằng tiếng Việt, có dấu câu đầy đủ.",
    ("en", None): "The following is a conversation in English, with proper punctuation.",
}

# Phrases Whisper is known to invent over silence or music (it learned them from video subtitles)
_HALLUCINATIONS = re.compile(
    r"^(terima kasih (telah|sudah) menonton|jangan lupa (like|subscribe)|thanks? (you )?for watching|"
    r"please subscribe|subtitles? by|字幕|请不吝点赞|謝謝觀看|谢谢观看|明镜与点点栏目|优优独播剧场|"
    # echoes of our own hint to Whisper, which it can repeat back on silence
    r"以下[是系](普通[话話]|广东话|廣東話)|[请請]加上[标標][点點]符[号號]|Berikut adalah percakapan|"
    r"The following is a conversation|with proper punctuation|词汇：|Kosakata:|"
    r"Berikut ialah perbualan|Sau đây là một cuộc hội thoại|Istilah:|Từ vựng:|"
    r"terima kasih kerana menonton|cảm ơn các bạn đã (theo dõi|xem)|hãy (subscribe|đăng ký) (cho )?kênh)",
    re.I,
)


def _prompt(opts: Options) -> str:
    key = (opts.source, opts.script if opts.source_is_chinese else None)
    prompt = _PROMPT.get(key, "")  # other languages: no hint, so Whisper isn't nudged toward another language
    terms = [g.split("=")[0].strip() for g in opts.glossary if g.strip()]
    if terms:
        lead = {"id": " Kosakata: ", "ms": " Istilah: ", "vi": " Từ vựng: "}.get(opts.source, " Terms: ")
        joiner = ("词汇：", "、", "。") if opts.source_is_chinese else (lead, ", ", ".")
        if not prompt:
            joiner = ("", ", ", "")
        prompt += joiner[0] + joiner[1].join(terms[:50]) + joiner[2]
    return prompt.strip()


def _keep(text: str, no_speech_prob: float = 0.0, avg_logprob: float = 0.0) -> bool:
    text = text.strip()
    if not text:
        return False
    if no_speech_prob > 0.6 and avg_logprob < -1.0:  # probably silence or noise
        return False
    return not _HALLUCINATIONS.match(text)


def transcribe(path: str, opts: Options) -> tuple[list[RawSegment], float]:
    """Returns (segments, duration_seconds), transcribing in opts.source."""
    segments, duration, _ = _run(path, opts.source, _prompt(opts) or None)
    return segments, duration


# Whisper reports detected languages by name or code; map the ones we care about.
_DETECTED = {
    "english": "en", "en": "en",
    "chinese": "zh", "mandarin": "zh", "zh": "zh",
    "cantonese": "yue", "yue": "yue",
    "indonesian": "id", "id": "id",
    "malay": "ms", "ms": "ms",
    "vietnamese": "vi", "vi": "vi",
    "thai": "th", "tagalog": "tl", "filipino": "tl", "khmer": "km", "japanese": "ja", "korean": "ko",
    "hindi": "hi", "tamil": "ta", "spanish": "es", "castilian": "es", "french": "fr", "german": "de",
    "italian": "it", "portuguese": "pt", "russian": "ru", "arabic": "ar", "turkish": "tr",
    **{code: code for code in LANG_NAMES},
    # often reported for Indonesian speech
    "javanese": "id", "jw": "id", "sundanese": "id", "su": "id",
}
# Indonesian and Malay are close enough that Whisper mixes them up; treat them as one family
_FAMILY = {"id": "idms", "ms": "idms"}
_HAN = re.compile(r"[\u3400-\u9fff]")


def _base(lang: str) -> str:
    return "zh" if lang == "yue" else _FAMILY.get(lang, lang)


def transcribe_detect(path: str, opts: Options) -> tuple[list[RawSegment], float, str]:
    """For conversations: work out which of the two languages (opts.source, opts.target) was spoken.

    Returns (segments, duration, spoken_language) where spoken_language is one of the pair.
    """
    pair = [opts.source, opts.target]
    terms = [g.split("=")[0].strip() for g in opts.glossary if g.strip()]
    segments, duration, detected = _run(path, None, ", ".join(terms[:30]) or None)
    lang = _DETECTED.get((detected or "").lower().strip())
    text = " ".join(s.text for s in segments)
    chosen = next((p for p in pair if lang and _base(p) == _base(lang)), None)
    if chosen is None:
        # Detection picked something outside the pair (e.g. Japanese for Chinese, Malay variants):
        # decide by script, then transcribe again in that language so the text is right.
        han_side = next((p for p in pair if _base(p) == "zh"), None)
        other = next((p for p in pair if _base(p) != "zh"), pair[0])
        chosen = han_side if (han_side and _HAN.search(text)) else other
        if segments:
            segments, duration, _ = _run(path, chosen, _prompt(opts.model_copy(update={"source": chosen})) or None)
    return segments, duration, chosen


def _run(path: str, language: str | None, prompt: str | None) -> tuple[list[RawSegment], float, str | None]:
    if config.ASR_PROVIDER == "local":
        return _run_local(path, language, prompt)
    return _run_openai(path, language, prompt)


def _run_openai(path: str, language: str | None, prompt: str | None):
    from openai import OpenAI

    client = OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY or None, max_retries=4)
    args = dict(model=config.OPENAI_TRANSCRIBE_MODEL, response_format="verbose_json")
    if language:
        args["language"] = _LANG_HOSTED[language]
    if prompt:
        args["prompt"] = prompt
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
    return segments, duration, raw.get("language")


@lru_cache(maxsize=1)
def _local_model():
    from faster_whisper import WhisperModel  # pip install faster-whisper

    return WhisperModel(config.LOCAL_WHISPER_MODEL, device="auto", compute_type="auto")


def _run_local(path: str, language: str | None, prompt: str | None):
    segments_iter, info = _local_model().transcribe(
        path,
        language=_LANG[language] if language else None,
        initial_prompt=prompt,
        vad_filter=True,  # skip silence
    )
    segments = [
        RawSegment(start=s.start, end=s.end, text=s.text.strip())
        for s in segments_iter
        if _keep(s.text, s.no_speech_prob, s.avg_logprob)
    ]
    return segments, float(info.duration), info.language

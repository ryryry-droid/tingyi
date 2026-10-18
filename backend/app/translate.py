"""Chinese -> English translation with Claude.

Segments are translated in batches, and each batch is sent together with the
previous few already-translated lines. Chinese often drops subjects and
pronouns, so that context is what lets the model pick "she"/"they"/"we"
correctly instead of guessing. The live mode will call `translate_lines` with
one or two new lines at a time and the recent lines as context.
"""
import json
import re

from . import config
from .models import Options, Segment

SYSTEM = """You translate transcribed spoken Chinese into English.

The Chinese comes from automatic speech recognition, so it may contain misheard
homophones, missing punctuation, or filler words (嗯, 那个, 就是). Translate what the
speaker most plausibly meant.

Rules:
- Translate every line you are given; keep the same ids. One English line per Chinese line.
- Use the earlier lines (marked as context) to resolve omitted subjects, pronouns and references,
  but do not translate the context lines themselves.
- Render chengyu and idioms by meaning, not word by word.
- Keep names consistent. Follow the glossary exactly where it applies.
- If a line is pure noise or unintelligible, return "[inaudible]".
- Reply with JSON only: {"translations": [{"id": <int>, "en": "<English>"}]}"""

STYLE = {
    "natural": "Style: natural, fluent spoken English, as a professional interpreter would say it.",
    "literal": "Style: stay close to the Chinese wording and structure while remaining grammatical English.",
}


def _client():
    from anthropic import Anthropic

    return Anthropic()


def _build_prompt(lines: list[Segment], context: list[Segment], opts: Options) -> str:
    parts = [STYLE[opts.style]]
    if opts.dialect == "cantonese":
        parts.append("The speaker is speaking Cantonese; the transcript may contain Cantonese characters (嘅, 咗, 唔).")
    if opts.glossary:
        parts.append("Glossary:\n" + "\n".join(f"- {g}" for g in opts.glossary))
    if context:
        parts.append(
            "Context (already translated, do not translate again):\n"
            + "\n".join(f"{c.zh} => {c.en}" for c in context)
        )
    parts.append(
        "Translate these lines:\n"
        + json.dumps([{"id": s.id, "zh": s.zh} for s in lines], ensure_ascii=False)
    )
    return "\n\n".join(parts)


def _parse(text: str) -> dict[int, str]:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"Translator did not return JSON: {text[:200]}")
    data = json.loads(match.group(0))
    return {int(t["id"]): str(t["en"]).strip() for t in data.get("translations", [])}


def translate_lines(lines: list[Segment], context: list[Segment], opts: Options) -> dict[int, str]:
    """Translate `lines`; returns {segment id: English}."""
    if not lines:
        return {}
    response = _client().messages.create(
        model=config.ANTHROPIC_MODEL,
        max_tokens=8000,
        system=SYSTEM,
        messages=[{"role": "user", "content": _build_prompt(lines, context, opts)}],
    )
    text = "".join(block.text for block in response.content if getattr(block, "type", "") == "text")
    result = _parse(text)
    missing = [s for s in lines if s.id not in result]
    if missing and len(missing) < len(lines):  # model skipped a few: retry just those once
        result.update(_parse_retry(missing, context, opts))
    return result


def _parse_retry(lines: list[Segment], context: list[Segment], opts: Options) -> dict[int, str]:
    try:
        return translate_lines(lines, context, opts)
    except Exception:
        return {}


def translate_all(segments: list[Segment], opts: Options) -> list[Segment]:
    """Fill in `.en` for every segment, batch by batch, carrying context forward."""
    size = max(1, config.TRANSLATE_BATCH_SIZE)
    done: list[Segment] = []
    for i in range(0, len(segments), size):
        batch = segments[i : i + size]
        context = done[-config.CONTEXT_SEGMENTS :]
        translations = translate_lines(batch, context, opts)
        for seg in batch:
            seg.en = translations.get(seg.id, "")
        done.extend(batch)
    return segments

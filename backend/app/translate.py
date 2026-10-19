"""Translation of transcribed speech between Mandarin/Cantonese, Indonesian and English.

Segments are translated in batches, and each batch is sent together with the
previous few already-translated lines. Chinese and casual Indonesian both often
drop subjects and pronouns, so that context is what lets the model pick
"she"/"they"/"we" correctly instead of guessing. The live mode will call
`translate_lines` with one or two new lines at a time and the recent lines as context.
"""
import json
import re

from . import config
from .models import LANG_NAMES, Options, Segment

SYSTEM = """You are a professional interpreter translating transcribed speech.

The text comes from automatic speech recognition, so it may contain misheard words,
missing punctuation, or filler words. Translate what the speaker most plausibly meant.

Rules:
- Translate every line you are given; keep the same ids. One translated line per input line.
- Use the earlier lines (marked as context) to resolve omitted subjects, pronouns and references,
  but do not translate the context lines themselves.
- Render idioms and set phrases by meaning, not word by word.
- Keep names consistent. Follow the glossary exactly where it applies.
- If a line is pure noise or unintelligible, return "[inaudible]".
- Reply with JSON only: {"translations": [{"id": <int>, "text": "<translation>"}]}"""

# Notes added only when that language is involved
SOURCE_NOTES = {
    "zh": "Spoken Mandarin often omits subjects; fillers include 嗯, 那个, 就是. Misheard homophones are common. "
    "Translate chengyu by meaning.",
    "yue": "The speaker is speaking Cantonese; the transcript may contain Cantonese characters (嘅, 咗, 唔, 係).",
    "id": "The speech may be casual or colloquial Indonesian (e.g. gak/nggak, udah, banget, aja, gimana) with particles "
    "like sih, dong, kok, deh, lho, and possibly Jakarta slang or regional words. Convey their tone, not just the words.",
    "ms": "The speech may be casual Malay (e.g. tak, dah, nak, je, kot, lah) as spoken in Malaysia or Singapore, possibly mixed "
    "with English. Convey the tone of particles like lah, kan, kot.",
    "vi": "Spoken Vietnamese may drop pronouns and use kinship terms (anh, chị, em, cô, chú) as pronouns; choose natural "
    "English pronouns from context. Particles like nhé, nha, ạ, à, đấy carry tone and politeness.",
    "en": "Spoken English may include fillers (um, like, you know) which should be dropped.",
}
TARGET_NOTES = {
    "en": "Write natural English.",
    "zh": "Write standard written Mandarin Chinese in {script} characters, with Chinese punctuation.",
    "id": "Write natural, standard Indonesian (Bahasa Indonesia) that is polite but not stiff, as people actually speak.",
    "ms": "Write natural, standard Malay (Bahasa Melayu, Malaysian usage) that is polite but not stiff.",
    "vi": "Write natural Vietnamese with full diacritics, polite but not stiff; choose pronouns that fit the context.",
}
SCRIPT_NAMES = {"simplified": "Simplified (简体)", "traditional": "Traditional (繁體)"}


def _style(opts: Options) -> str:
    tgt = LANG_NAMES[opts.target]
    if opts.style == "literal":
        return f"Style: stay close to the original wording and structure while remaining grammatical {tgt}."
    return f"Style: natural, fluent spoken {tgt}, as a professional interpreter would say it."


def _client():
    from anthropic import Anthropic

    return Anthropic()


def _openai_client():
    from openai import OpenAI

    # retries back off and honour "retry-after" when a free-plan rate limit is hit
    return OpenAI(base_url=config.OPENAI_BASE_URL, api_key=config.OPENAI_API_KEY or None, max_retries=6)


def _complete(prompt: str) -> str:
    """Send one translation request to the configured provider; returns the reply text."""
    if config.TRANSLATE_PROVIDER == "anthropic":
        response = _client().messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=8000,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in response.content if getattr(b, "type", "") == "text")

    args = dict(
        model=config.OPENAI_TRANSLATE_MODEL,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    if "gpt-oss" in config.OPENAI_TRANSLATE_MODEL:
        args["reasoning_effort"] = "low"  # less hidden reasoning = fewer tokens against the limit
    response = _openai_client().chat.completions.create(**args)
    return response.choices[0].message.content or ""


def _build_prompt(lines: list[Segment], context: list[Segment], opts: Options) -> str:
    parts = [
        f"Translate from {LANG_NAMES[opts.source]} into {LANG_NAMES[opts.target]}.",
        SOURCE_NOTES.get(opts.source, ""),
        TARGET_NOTES.get(opts.target, "Write natural, everyday {name}.").format(
            script=SCRIPT_NAMES[opts.script], name=LANG_NAMES[opts.target]
        ),
        _style(opts),
    ]
    if opts.glossary:
        parts.append("Glossary:\n" + "\n".join(f"- {g}" for g in opts.glossary))
    if context:
        parts.append(
            "Context (already translated, do not translate again):\n"
            + "\n".join(f"{c.text} => {c.translation}" for c in context)
        )
    parts.append(
        "Translate these lines:\n" + json.dumps([{"id": s.id, "text": s.text} for s in lines], ensure_ascii=False)
    )
    return "\n\n".join(parts)


def _parse(text: str) -> dict[int, str]:
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError(f"Translator did not return JSON: {text[:200]}")
    data = json.loads(match.group(0))
    out = {}
    for t in data.get("translations", []):
        value = t.get("text", t.get("translation", t.get("en", "")))
        out[int(t["id"])] = str(value).strip()
    return out


def translate_lines(lines: list[Segment], context: list[Segment], opts: Options) -> dict[int, str]:
    """Translate `lines`; returns {segment id: translation}."""
    if not lines:
        return {}
    if opts.same_language:
        return {s.id: s.text for s in lines}
    result = _parse(_complete(_build_prompt(lines, context, opts)))
    missing = [s for s in lines if s.id not in result]
    if missing and len(missing) < len(lines):  # model skipped a few: retry just those once
        result.update(_retry(missing, context, opts))
    return result


def _retry(lines: list[Segment], context: list[Segment], opts: Options) -> dict[int, str]:
    try:
        return translate_lines(lines, context, opts)
    except Exception:
        return {}


def translate_all(segments: list[Segment], opts: Options) -> list[Segment]:
    """Fill in `.translation` for every segment, batch by batch, carrying context forward."""
    size = max(1, config.TRANSLATE_BATCH_SIZE)
    done: list[Segment] = []
    for i in range(0, len(segments), size):
        batch = segments[i : i + size]
        context = done[-config.CONTEXT_SEGMENTS :]
        translations = translate_lines(batch, context, opts)
        for seg in batch:
            seg.translation = translations.get(seg.id, "")
        done.extend(batch)
    return segments


TITLE_LANG = {"en": "English", "zh": "Simplified Chinese", "id": "Indonesian", "ms": "Malay", "vi": "Vietnamese"}


def make_title(segments: list[Segment], opts: Options) -> str:
    """A short, descriptive title for the whole recording ("" if it can't be made)."""
    lines = [s.translation or s.text for s in segments if (s.translation or s.text) and s.translation != "[inaudible]"]
    if not lines:
        return ""
    transcript = "\n".join(lines)[:4000]  # the opening is plenty for a title, and keeps it cheap
    lang = "en" if "en" in (opts.source, opts.target) else opts.target
    language = TITLE_LANG.get(lang) or LANG_NAMES[lang]
    if lang == "zh" and opts.script == "traditional":
        language = "Traditional Chinese"
    prompt = (
        f"Write a short title (3 to 6 words) in {language} that says what this conversation is about, "
        "like a note title: specific, no quotation marks, no ending punctuation, not starting with "
        '"Conversation about" or "Discussion of".\n\n'
        f"Transcript:\n{transcript}\n\n"
        'Reply with JSON only: {"title": "..."}'
    )
    try:
        text = _complete_simple(prompt)
        match = re.search(r"\{.*\}", text, re.S)
        title = json.loads(match.group(0)).get("title", "") if match else ""
    except Exception:
        return ""
    return str(title).strip().strip("\"'“”「」。.!").strip()[:80]


def _complete_simple(prompt: str, max_tokens: int = 200) -> str:
    if config.TRANSLATE_PROVIDER == "anthropic":
        response = _client().messages.create(
            model=config.ANTHROPIC_MODEL, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}]
        )
        return "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
    args = dict(
        model=config.OPENAI_TRANSLATE_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    if "gpt-oss" in config.OPENAI_TRANSLATE_MODEL:
        args["reasoning_effort"] = "low"
    response = _openai_client().chat.completions.create(**args)
    return response.choices[0].message.content or ""


LOOKUP_LANG = {"zh": "Mandarin Chinese", "yue": "Cantonese", "id": "Indonesian", "ms": "Malay", "vi": "Vietnamese"}


def classify_register(words: list[str], lang: str) -> dict[str, tuple[str, str]]:
    """For each word: ("colloquial" | "standard", standard form if colloquial)."""
    language = LOOKUP_LANG.get(lang) or LANG_NAMES[lang]
    prompt = (
        f"For each {language} word below, say whether it is colloquial (slang, informal, or mainly casual spoken "
        f"{language}) or standard. For colloquial words, also give the standard/formal word with the same meaning.\n\n"
        + "\n".join(words)
        + '\n\nReply with JSON only: {"words": [{"word": "...", "register": "colloquial" or "standard", "standard": "..."}]}'
    )
    text = _complete_simple(prompt, max_tokens=60 + 40 * len(words))
    match = re.search(r"\{.*\}", text, re.S)
    out: dict[str, tuple[str, str]] = {}
    if match:
        for item in json.loads(match.group(0)).get("words", []):
            w = str(item.get("word") or "").strip()
            reg = "colloquial" if str(item.get("register") or "").lower().startswith("colloq") else "standard"
            if w:
                out[w.lower()] = (reg, str(item.get("standard") or "").strip() if reg == "colloquial" else "")
    return out


def lookup_word(word: str, sentence: str, lang: str, script: str, from_english: bool = False) -> dict:
    """Dictionary entry for a word, aimed at an English-speaking learner."""
    language = LOOKUP_LANG.get(lang) or LANG_NAMES[lang]
    chinese = lang in ("zh", "yue")
    script_note = (
        f" Write all Chinese in {'Traditional' if script == 'traditional' else 'Simplified'} characters." if chinese else ""
    )
    root_note = (
        ' If the word has affixes (me-, di-, ber-, ter-, -kan, -nya, -an...), put its base word in "root", else "".'
        if lang in ("id", "ms")
        else ' Set "root" to "".'
    )
    if lang == "vi":
        root_note += (
            " Vietnamese words are often several syllables written separately (e.g. cảm ơn, học sinh): if the tapped"
            " syllable is part of a longer word in the sentence, look up the whole word."
        )
    if from_english:
        intro = (
            f"You are a {language}–English learner's dictionary. The learner wants to know how to say the English "
            f"word or phrase \"{word}\" in {language}. Give the most common everyday {language} word for it "
            "(in its usual meaning), and describe that word.\n\n"
        )
    else:
        intro = (
            f"You are a {language}–English learner's dictionary. The learner tapped the {language} word "
            f"\"{word}\" in this sentence:\n{sentence or word}\n\n"
        )
    prompt = (
        intro +
        "Reply with JSON only, in this shape:\n"
        '{"word": "<the word as it should be looked up, written as in a dictionary: lowercase unless it is a proper noun>", '
        '"root": "", "part_of_speech": "<noun, verb, ..., or proper noun for names of people, places, brands>", '
        '"meaning": "<its common English meanings, 12 words max>", '
        '"in_context": "<what it means in this sentence, 15 words max>", '
        '"notes": "<one short usage note (register, slang, measure word, tone of a particle), or empty>", '
        '"register": "<colloquial if it is slang, informal or mainly casual spoken language, else standard>", '
        '"standard": "<if colloquial: the standard/formal word with the same meaning, else empty>", '
        f'"example": {{"text": "<a new, short, everyday {language} sentence using the word>", '
        '"translation": "<its English translation>"}}\n'
        + (
            f'"word" must be the {language} word, not the English one. Leave "in_context" empty.'
            if from_english
            else "If the tapped text is only part of a word, look up the whole word."
        )
        + root_note
        + script_note
    )
    text = _complete_simple(prompt, max_tokens=500)
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise ValueError("The dictionary didn't return an entry")
    return json.loads(match.group(0))

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
    "tr": "Spoken Turkish often drops subject pronouns and uses suffixes for politeness and tense; casual speech may "
    "include fillers like yani, şey, işte. Convey tone (e.g. -sın/-sınız formality) naturally.",
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


import time

_resting: dict[str, float] = {}  # service name -> time until which it's skipped (its limit was reached)


def _chat(messages: list[dict], temperature: float, effort: str = "low", max_tokens: int | None = None) -> str:
    """One chat request to the OpenAI-compatible services in config.CHAT_SERVICES, in order.

    Everyday translation uses the first service (Groq); in-depth checks prefer config.CAREFUL_SERVICE (Gemini).
    When a service hits its rate limit (e.g. a free plan's daily allowance), the next one is used, and the
    limited one is left alone for a while."""
    from openai import BadRequestError, OpenAI, RateLimitError

    services = config.CHAT_SERVICES
    if effort != "low" and config.CAREFUL_SERVICE:
        # in-depth work (word lookups and their second check, Redo) goes to Gemini first when it's set up
        services = sorted(services, key=lambda s: s[0] != config.CAREFUL_SERVICE)
    available = [s for s in services if _resting.get(s[0], 0) <= time.time()] or services[-1:]
    last_error: Exception | None = None
    for i, (name, base_url, key, model) in enumerate(available):
        has_backup = i < len(available) - 1
        # with a backup, don't wait long on a limited service; on the last one, retries back off and
        # honour "retry-after"
        client = OpenAI(base_url=base_url, api_key=key or None, max_retries=1 if has_backup else 6)
        args: dict = dict(model=model, messages=messages, temperature=temperature, response_format={"type": "json_object"})
        if "gpt-oss" in model or "gemini" in model:
            args["reasoning_effort"] = effort  # "low" normally: less hidden reasoning = fewer tokens against limits
        if max_tokens and "gpt-oss" in model and effort != "low":
            args["max_completion_tokens"] = max_tokens + 3000  # room to think before answering
        try:
            try:
                response = client.chat.completions.create(**args)
            except BadRequestError:
                args.pop("response_format", None)  # in case a service doesn't support JSON mode
                response = client.chat.completions.create(**args)
            return response.choices[0].message.content or ""
        except RateLimitError as e:
            last_error = e
            daily = any(w in str(e).lower() for w in ("per day", "daily", "quota", "rpd", "tpd"))
            _resting[name] = time.time() + (3600 if daily else 60)
            if not has_backup:
                raise
    raise last_error or RuntimeError("No translation service available")


def _complete(prompt: str, effort: str = "low") -> str:
    """Send one translation request to the configured provider; returns the reply text."""
    if config.TRANSLATE_PROVIDER == "anthropic":
        response = _client().messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=8000,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in response.content if getattr(b, "type", "") == "text")

    return _chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], 0.2, effort)


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


def translate_lines(lines: list[Segment], context: list[Segment], opts: Options, careful: bool = False) -> dict[int, str]:
    """Translate `lines`; returns {segment id: translation}. careful=True thinks harder (used for Redo)."""
    if not lines:
        return {}
    if opts.same_language:
        return {s.id: s.text for s in lines}
    result = _parse(_complete(_build_prompt(lines, context, opts), effort="medium" if careful else "low"))
    missing = [s for s in lines if s.id not in result]
    if missing and len(missing) < len(lines):  # model skipped a few: retry just those once
        result.update(_retry(missing, context, opts))
    return result


def _retry(lines: list[Segment], context: list[Segment], opts: Options) -> dict[int, str]:
    try:
        return translate_lines(lines, context, opts)
    except Exception:
        return {}


def translate_all(segments: list[Segment], opts: Options, keep_going: bool = False) -> str:
    """Fill in `.translation` for every segment, batch by batch, carrying context forward.

    keep_going=True: a batch that fails is left untranslated instead of failing everything; returns the
    first error ("" if all went well)."""
    size = max(1, config.TRANSLATE_BATCH_SIZE)
    done: list[Segment] = []
    error = ""
    for i in range(0, len(segments), size):
        batch = segments[i : i + size]
        context = [s for s in done if s.translation][-config.CONTEXT_SEGMENTS :]
        try:
            translations = translate_lines(batch, context, opts)
        except Exception as e:
            if not keep_going:
                raise
            error = error or str(e)
            translations = {}
        for seg in batch:
            seg.translation = translations.get(seg.id, "")
        done.extend(batch)
    return error


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


def _complete_simple(prompt: str, max_tokens: int = 200, effort: str = "low") -> str:
    if config.TRANSLATE_PROVIDER == "anthropic":
        response = _client().messages.create(
            model=config.ANTHROPIC_MODEL, max_tokens=max_tokens, messages=[{"role": "user", "content": prompt}]
        )
        return "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
    return _chat([{"role": "user", "content": prompt}], 0.3 if effort == "low" else 0.1, effort, max_tokens)


LOOKUP_LANG = {"zh": "Mandarin Chinese", "yue": "Cantonese", "id": "Indonesian", "ms": "Malay", "vi": "Vietnamese"}


def redo_line(heard: str, original: str, original_translation: str, before: list[Segment], after: list[str],
              opts: Options) -> tuple[str, str]:
    """Redo one line: compare the first transcript with a second listen, keep what was right, fix what wasn't,
    and translate it again using the lines around it. Returns (text, translation)."""
    src, tgt = LANG_NAMES[opts.source], LANG_NAMES[opts.target]
    parts = [
        f"A {src} conversation was transcribed by speech recognition and translated into {tgt}. The user thinks one "
        "line may be wrong, so its audio was listened to again. Produce the best version of that line and its translation.",
        "How to decide the line's text:\n"
        "- The first transcript is usually right. Keep its words unless the second listen clearly heard a different, "
        "similar-sounding word that makes more sense here, or a word in it doesn't exist in " + src + " or makes no sense.\n"
        "- The second listen covers a little more audio than the line, so it may start or end with words from the "
        "lines before or after. Ignore those; never move words from neighbouring lines into this one.\n"
        "- Real casual, slang and colloquial words are correct; don't make them formal. Don't rephrase.",
        "How to translate:\n"
        "- Use the lines before and after to understand who is speaking about what.\n"
        "- The old translation is there for reference: if it already says the right thing for the line's text, keep it. "
        "Only change what is wrong or missing.",
        SOURCE_NOTES.get(opts.source, ""),
        TARGET_NOTES.get(opts.target, "Write natural, everyday {name}.").format(script=SCRIPT_NAMES[opts.script], name=tgt),
        _style(opts),
    ]
    if opts.glossary:
        parts.append("Glossary:\n" + "\n".join(f"- {g}" for g in opts.glossary))
    if before:
        parts.append("Lines before (with their translations):\n" + "\n".join(f"{c.text} => {c.translation}" for c in before))
    if after:
        parts.append("Lines after:\n" + "\n".join(after))
    if original:
        parts.append(f"First transcript of the line: {original}\nOld translation: {original_translation or '(none)'}")
        parts.append(f"Second listen (the line plus a little either side): {heard}")
    else:
        parts.append(f"The line, as heard: {heard}")
    parts.append('Reply with JSON only: {"text": "<the line in ' + src + '>", "translation": "<the line in ' + tgt + '>"}')
    data = _json(_chat([{"role": "user", "content": "\n\n".join(p for p in parts if p)}], 0.1, "medium", 800)) or {}
    text = str(data.get("text") or "").strip() or original or heard
    translation = text if opts.same_language else str(data.get("translation") or "").strip()
    if not translation:
        raise ValueError("The translator didn't return a translation")
    return text, translation


def word_family(word: str, lang: str, meaning: str = "") -> dict:
    """The base word and its common affixed forms, each with a meaning and an example."""
    language = LOOKUP_LANG.get(lang) or LANG_NAMES[lang]
    prompt = (
        f"You are a {language}–English learner's dictionary. The learner saved the {language} word \"{word}\""
        + (f" ({meaning})" if meaning else "") + ". "
        f"Give its word family: the base (root) word, and the common, real forms built from it with prefixes and "
        "suffixes (for example me-, di-, ter-, ber-, pe-, pe-an, ke-an, -kan, -i). Only include forms a native "
        "speaker would actually use; never invent a form. Include the saved word itself. Put the base word first, "
        "then verbs, then nouns and others. At most 8 forms.\n"
        "For each form: its part of speech, its English meaning (10 words max) and a short everyday example sentence "
        "with its English translation.\n"
        'Reply with JSON only: {"base": "...", "forms": [{"word": "...", "part_of_speech": "...", "meaning": "...", '
        '"example": {"text": "...", "translation": "..."}}]}'
    )
    data = _json(_complete_simple(prompt, max_tokens=1600, effort="low")) or {}
    if not data.get("forms"):
        raise ValueError("The dictionary didn't return a word family")
    return data


def example_for(word: str, lang: str, script: str, meaning: str, english: str) -> str:
    """A natural sentence in `lang` that uses `word` and means the English sentence."""
    language = LOOKUP_LANG.get(lang) or LANG_NAMES[lang]
    script_note = (
        f" Write it in {'Traditional' if script == 'traditional' else 'Simplified'} Chinese characters."
        if lang in ("zh", "yue") else ""
    )
    prompt = (
        f"A learner is studying the {language} word \"{word}\"" + (f" ({meaning})" if meaning else "") + ". "
        f"They wrote this English example sentence for it:\n{english}\n\n"
        f"Write the {language} sentence that says exactly this, the way a native speaker naturally would, and use "
        f"the word \"{word}\" in it (in a fitting form if {language} changes word forms). Keep it everyday and "
        "correct; don't add anything that isn't in the English." + script_note + "\n"
        'Reply with JSON only: {"text": "<the sentence>"}'
    )
    data = _json(_complete_simple(prompt, max_tokens=300, effort="medium")) or {}
    text = str(data.get("text") or "").strip()
    if not text:
        raise ValueError("The translator didn't return a sentence")
    return text


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


def lookup_word(word: str, sentence: str, lang: str, script: str, from_english: bool = False, strict: bool = False,
                sense: str = "", known: str = "") -> dict:
    """strict=True (Add word, Double-check): thinks harder and has the entry checked a second time."""
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
    senses: list[dict] = []
    if from_english and not sense:
        # Words like "track" (running track / to follow someone) need different words: find those meanings
        # first, in a separate step, then describe the most common one
        try:
            senses = english_senses(word, language)
        except Exception:
            senses = []
        if len(senses) > 1:
            sense = senses[0]["sense"]
    if from_english and sense:
        intro = (
            f"You are a {language}–English learner's dictionary. The learner wants to know how to say the English "
            f"word or phrase \"{word}\" in {language}, in this meaning: {sense}. Give the most common everyday "
            f"{language} word for that meaning, and describe that word.\n\n"
        )
    elif from_english:
        intro = (
            f"You are a {language}–English learner's dictionary. The learner wants to know how to say the English "
            f"word or phrase \"{word}\" in {language}. Give the most common everyday {language} word for it "
            "(in its most common meaning), and describe that word.\n\n"
        )
    elif known:
        intro = (
            f"You are a {language}–English learner's dictionary. \"{word}\" is a Singapore Mandarin term (from the "
            f"Singaporean Mandarin Database). Its meaning is: {known}. That meaning is correct: use it for \"meaning\" "
            "(you may add a few words to make it clearer, never change it), and describe the term as it is used in "
            "Singapore, not mainland China. In \"notes\", give the standard Mandarin word for it if there is a "
            "different one, and where the term comes from (e.g. from Malay, Hokkien, Cantonese or English) only if "
            "you are sure; otherwise leave that out. Write the example as something a Singaporean would naturally say. "
            "Don't guess: if you're unsure about anything except the meaning, leave it out.\n\n"
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
        + _EXISTS_NOTE.format(language=language)
    )
    entry = _json(_complete_simple(prompt, max_tokens=600 if strict else 500, effort="medium" if strict else "low"))
    if entry is None:
        raise ValueError("The dictionary didn't return an entry")
    entry.pop("senses", None)
    if senses:
        entry["senses"] = senses
    if not strict:
        return entry
    # Second opinion: a separate check of the entry, so invented words and meanings get caught
    asked = (f'the learner asked how to say the English "{word}"' + (f" meaning {sense}" if sense else "")
             if from_english else
             f'"{word}" is a Singapore Mandarin term meaning: {known} (this meaning is correct; check the rest against '
             "how it is used in Singapore)" if known else sentence or word)
    try:
        checked = _json(_complete_simple(_CHECK.format(language=language, entry=json.dumps(entry, ensure_ascii=False),
                                                       sentence=asked), max_tokens=600, effort="low"))  # checking is lighter work than writing
    except Exception:
        checked = None
    if checked and checked.get("word"):
        checked.pop("senses", None)
        entry = {**entry, **checked}
    if known:  # a known term: it exists, and its meaning stays the known one
        entry["exists"] = True
        entry["suggestions"] = []
        if known.lower() not in str(entry.get("meaning") or "").lower():
            entry["meaning"] = known
    if entry.get("exists") is False:
        entry["meaning"] = ""
        entry["example"] = None
    return entry


def english_senses(word: str, language: str) -> list[dict]:
    """The everyday meanings of an English word that need different words in `language`, most common first.

    [] when one word covers them all (e.g. "weekend"), or when it isn't an English word at all."""
    prompt = (
        f'A learner typed "{word}" and wants to say it in {language}. First decide whether "{word}" is an English '
        f"word or phrase. If it is not English (for example it is already a {language} word), set \"english\" to "
        "false and \"senses\" to [].\n"
        "If it is English: it may have several quite different meanings (as a noun and as a verb, or unrelated "
        "senses). List the common everyday meanings of THIS English word, and for each the most common "
        f"{language} word a native speaker would use for that meaning.\n"
        "Rules: describe each meaning in plain English (6 words max, add (noun) or (verb)); "
        f"each meaning must need a DIFFERENT {language} word — merge meanings that use the same word; most common "
        f"meaning first; at most 5. If one {language} word covers every common meaning, return an empty list.\n"
        'Reply with JSON only: {"english": true or false, "senses": [{"sense": "...", "word": "..."}]}'
    )
    data = _json(_complete_simple(prompt, max_tokens=500, effort="medium")) or {}
    if data.get("english") is False:
        return []
    out: list[dict] = []
    for item in data.get("senses") or []:
        if not isinstance(item, dict):
            continue
        sense, w = str(item.get("sense") or "").strip(), str(item.get("word") or "").strip()
        # the point is to choose between different words: drop repeats of a word or a meaning
        if sense and w and not any(o["word"].lower() == w.lower() or o["sense"].lower() == sense.lower() for o in out):
            out.append({"sense": sense, "word": w})
    return out[:5] if len(out) > 1 else []


_EXISTS_NOTE = (
    '\nAlso include "exists": true or false, and "suggestions": [...].\n'
    "Before answering, check carefully that this is a real {language} word (or a regular inflected / affixed form of one, "
    "or an established slang or colloquial word) that a good dictionary or native speakers would recognise. "
    "Never invent a meaning for a word you don't actually know. If it is not a real word — for example a mishearing "
    'or a typo — set "exists" to false, leave "meaning" empty, and put in "suggestions" up to 3 real {language} words '
    'that were most likely meant (use the sentence to judge). If it is real, set "exists" to true and "suggestions" to [].'
)

_CHECK = (
    "You are checking an entry, written by someone else, for a {language}–English learner's dictionary. Be strict: "
    "learners will memorise it.\n\nSentence it came from: {sentence}\nEntry: {entry}\n\n"
    "Check: (1) Is \"word\" really a {language} word (or a regular affixed / inflected form, or established slang) "
    "that native speakers would recognise? (2) Is the meaning right? (3) Is the example correct, natural {language} "
    "using that word, and is its translation right? (4) Are part of speech, root and register right?\n"
    "Reply with the corrected entry as JSON only, with the same keys. If the word does not exist, set "
    '"exists": false, "meaning": "" and "suggestions" to up to 3 real words that were most likely meant.'
)


def _json(text: str):
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

"""The full record-then-translate pipeline, built from per-chunk steps.

    audio -> asr.transcribe -> clean_segments -> translate.translate_all -> finish_translation -> make_title

Live mode (later) reuses the same steps on small chunks:
    every ~pause: asr on the new chunk -> clean_segments -> translate_lines(new, context=recent)
"""
from . import asr, translate
from .models import Options, RawSegment, Segment, TranslateResponse
from .textproc import to_pinyin, to_script


def clean_segments(raw: list[RawSegment], opts: Options, start_id: int = 0) -> list[Segment]:
    segments = []
    for i, r in enumerate(raw):
        text = to_script(r.text, opts.script) if opts.source_is_chinese else r.text
        segments.append(
            Segment(
                id=start_id + i,
                start=round(r.start, 2),
                end=round(r.end, 2),
                text=text,
                pinyin=to_pinyin(text) if opts.pinyin and opts.source_is_chinese else None,
            )
        )
    return segments


def finish_translation(text: str, opts: Options) -> tuple[str, str | None]:
    """Fix the script of Chinese output and add its pinyin."""
    if not opts.target_is_chinese or not text:
        return text, None
    text = to_script(text, opts.script)
    return text, (to_pinyin(text) if opts.pinyin and not opts.source_is_chinese else None)


def process_recording(path: str, opts: Options) -> TranslateResponse:
    raw, duration = asr.transcribe(path, opts)
    segments = clean_segments(raw, opts)
    # The transcript is kept even if translating fails, so it isn't lost; untranslated lines can be retried
    error = translate.translate_all(segments, opts, keep_going=True)
    for seg in segments:
        seg.translation, seg.translation_pinyin = finish_translation(seg.translation, opts)
    try:
        title = translate.make_title(segments, opts) if segments and not error else ""
    except Exception:
        title = ""
    if title and opts.target_is_chinese and "en" not in (opts.source, opts.target):
        title = to_script(title, opts.script)
    return TranslateResponse(
        source=opts.source,
        target=opts.target,
        language=opts.source,
        title=title,
        duration=round(duration, 2),
        segments=segments,
        translation_error=f"Translation failed: {error}" if error else "",
    )

"""The full record-then-translate pipeline, built from per-chunk steps.

    audio -> asr.transcribe -> clean_segments -> translate.translate_all

Live mode (later) reuses the same steps on small chunks:
    every ~pause: asr on the new chunk -> clean_segments -> translate_lines(new, context=recent)
"""
from . import asr, translate
from .models import Options, RawSegment, Segment, TranslateResponse
from .textproc import to_pinyin, to_script


def clean_segments(raw: list[RawSegment], opts: Options, start_id: int = 0) -> list[Segment]:
    segments = []
    for i, r in enumerate(raw):
        zh = to_script(r.text, opts.script)
        segments.append(
            Segment(
                id=start_id + i,
                start=round(r.start, 2),
                end=round(r.end, 2),
                zh=zh,
                pinyin=to_pinyin(zh) if opts.pinyin else None,
            )
        )
    return segments


def process_recording(path: str, opts: Options) -> TranslateResponse:
    raw, duration = asr.transcribe(path, opts)
    segments = clean_segments(raw, opts)
    translate.translate_all(segments, opts)
    return TranslateResponse(language=opts.dialect, duration=round(duration, 2), segments=segments)

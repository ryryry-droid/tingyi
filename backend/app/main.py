"""HTTP API and phone web app.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import json
import os
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from . import config, translate
from .models import (
    LiveSegment,
    LiveTranscribeResponse,
    LiveTranslateRequest,
    LiveTranslateResponse,
    LiveTranslation,
    TitleRequest,
    TitleResponse,
    Example,
    LookupRequest,
    LookupResponse,
    Options,
    RetranslateRequest,
    RetranslateResponse,
    Segment,
    TranslateResponse,
)
from .pipeline import clean_segments, finish_translation, process_recording
from . import asr
from .textproc import to_pinyin, to_script

app = FastAPI(title="Tingyi speech translator")


def check_token(authorization: str = Header(default="")) -> None:
    if config.API_TOKEN and authorization != f"Bearer {config.API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid or missing API token")


STATIC = Path(__file__).parent / "static"
AUDIO_EXTS = {".m4a", ".mp4", ".mp3", ".mpeg", ".mpga", ".wav", ".webm", ".ogg", ".oga", ".flac", ".aac"}


# ---- phone web app (record in the browser) ----
@app.get("/", include_in_schema=False)
def web_app() -> FileResponse:
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest() -> FileResponse:
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/icon-{size}.png", include_in_schema=False)
def icon(size: int) -> FileResponse:
    if size not in (192, 512):
        raise HTTPException(status_code=404)
    return FileResponse(STATIC / f"icon-{size}.png", media_type="image/png")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "asr": config.ASR_PROVIDER,
        "transcriber": config.OPENAI_TRANSCRIBE_MODEL if config.ASR_PROVIDER == "openai" else config.LOCAL_WHISPER_MODEL,
        "translator": config.TRANSLATE_MODEL,
        "token_required": bool(config.API_TOKEN),
    }


@app.post("/api/translate", response_model=TranslateResponse, dependencies=[Depends(check_token)])
async def translate_recording(
    file: UploadFile = File(...),
    options: str = Form("{}"),  # JSON-encoded Options
) -> TranslateResponse:
    try:
        opts = Options(**json.loads(options or "{}"))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Bad options: {e}")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Recording is over {config.MAX_UPLOAD_MB} MB")

    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in AUDIO_EXTS:
        suffix = ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        return await run_in_threadpool(process_recording, path, opts)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Processing failed: {e}")
    finally:
        os.unlink(path)  # audio is not kept on the server


@app.post("/api/retranslate", response_model=RetranslateResponse, dependencies=[Depends(check_token)])
async def retranslate(req: RetranslateRequest) -> RetranslateResponse:
    opts = req.options
    text = (req.text or req.zh).strip()
    if opts.source_is_chinese:
        text = to_script(text, opts.script)
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    line = Segment(id=0, start=0, end=0, text=text)
    context = [c for c in req.context if c.translation][-config.CONTEXT_SEGMENTS :]
    try:
        result = await run_in_threadpool(translate.translate_lines, [line], context, opts)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Translation failed: {e}")
    translation, translation_pinyin = finish_translation(result.get(0, ""), opts)
    return RetranslateResponse(
        text=text,
        pinyin=to_pinyin(text) if opts.pinyin and opts.source_is_chinese else None,
        translation=translation,
        translation_pinyin=translation_pinyin,
    )


@app.post("/api/lookup", response_model=LookupResponse, dependencies=[Depends(check_token)])
async def lookup(req: LookupRequest) -> LookupResponse:
    chinese = req.lang in ("zh", "yue")
    word = req.word.strip()
    try:
        entry = await run_in_threadpool(translate.lookup_word, word, req.sentence.strip(), req.lang, req.script)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Lookup failed: {e}")

    def clean(v) -> str:
        return str(v or "").strip()

    looked_up = clean(entry.get("word")) or word
    if chinese:
        looked_up = to_script(looked_up, req.script)
    example = None
    ex = entry.get("example") or {}
    if clean(ex.get("text")):
        ex_text = to_script(clean(ex["text"]), req.script) if chinese else clean(ex["text"])
        example = Example(text=ex_text, pinyin=to_pinyin(ex_text) if chinese else None, translation=clean(ex.get("translation")))
    return LookupResponse(
        word=looked_up,
        lang=req.lang,
        pinyin=to_pinyin(looked_up) if chinese else None,
        root=clean(entry.get("root")) if req.lang == "id" else "",
        part_of_speech=clean(entry.get("part_of_speech")),
        meaning=clean(entry.get("meaning")) or "No meaning found",
        in_context=clean(entry.get("in_context")),
        notes=clean(entry.get("notes")),
        example=example,
    )


# ---------------- live mode ----------------
# The page sends short audio chunks cut at pauses. Transcription and translation are separate calls so
# the transcript can appear immediately and translations can be batched (gentler on free-plan limits).


@app.post("/api/live/transcribe", response_model=LiveTranscribeResponse, dependencies=[Depends(check_token)])
async def live_transcribe(
    file: UploadFile = File(...),
    options: str = Form("{}"),
    offset: float = Form(0.0),  # where this chunk starts in the session, in seconds
    detect: bool = Form(False),  # conversation mode: spoken language is either options.source or options.target
) -> LiveTranscribeResponse:
    try:
        opts = Options(**json.loads(options or "{}"))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Bad options: {e}")
    data = await file.read()
    if not data:
        return LiveTranscribeResponse(segments=[])
    suffix = os.path.splitext(file.filename or "")[1].lower()
    with tempfile.NamedTemporaryFile(suffix=suffix if suffix in AUDIO_EXTS else ".wav", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        if detect:
            raw, _, spoken = await run_in_threadpool(asr.transcribe_detect, path, opts)
        else:
            raw, _ = await run_in_threadpool(asr.transcribe, path, opts)
            spoken = opts.source
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    finally:
        os.unlink(path)

    spoken_opts = opts.model_copy(update={"source": spoken})
    if detect:  # translate into the other language of the pair
        other = opts.target if spoken == opts.source else opts.source
        target = "zh" if other == "yue" else other
    else:
        target = opts.target
    lines = clean_segments(raw, spoken_opts)
    return LiveTranscribeResponse(
        segments=[
            LiveSegment(
                start=round(offset + s.start, 2), end=round(offset + s.end, 2), text=s.text, pinyin=s.pinyin,
                lang=spoken, target=target,
            )
            for s in lines
        ]
    )


@app.post("/api/live/translate", response_model=LiveTranslateResponse, dependencies=[Depends(check_token)])
async def live_translate(req: LiveTranslateRequest) -> LiveTranslateResponse:
    opts = req.options
    lines = [Segment(id=l.id, start=0, end=0, text=l.text) for l in req.lines if l.text.strip()]
    context = [Segment(id=-1 - i, start=0, end=0, text=c.text, translation=c.translation) for i, c in enumerate(req.context[-6:])]
    try:
        result = await run_in_threadpool(translate.translate_lines, lines, context, opts)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Translation failed: {e}")
    out = []
    for line in lines:
        text, py = finish_translation(result.get(line.id, ""), opts)
        out.append(LiveTranslation(id=line.id, translation=text, translation_pinyin=py))
    return LiveTranslateResponse(translations=out)


@app.post("/api/title", response_model=TitleResponse, dependencies=[Depends(check_token)])
async def make_title(req: TitleRequest) -> TitleResponse:
    segs = [Segment(id=i, start=0, end=0, text=l.text, translation=l.translation) for i, l in enumerate(req.lines)]
    title = await run_in_threadpool(translate.make_title, segs, req.options)
    return TitleResponse(title=title)

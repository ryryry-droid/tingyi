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
from .models import Options, RetranslateRequest, RetranslateResponse, Segment, TranslateResponse
from .pipeline import finish_translation, process_recording
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

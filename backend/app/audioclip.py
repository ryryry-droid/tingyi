"""Cut one part out of a recording (for re-doing a single line)."""
import tempfile
import wave

RATE = 16000


def cut(path: str, start: float, end: float, pad: float = 0.35) -> tuple[str, float]:
    """Writes start..end (plus a little padding) as 16 kHz mono WAV; returns (wav path, seconds).

    Works with any format the phone records (m4a, webm, ogg, wav...)."""
    import av  # PyAV: ffmpeg's decoders, installed from a wheel

    lo = max(0.0, start - pad)
    hi = end + pad
    out = bytearray()
    with av.open(path) as container:
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=RATE)
        if lo > 1:
            try:
                container.seek(int(max(0.0, lo - 1) / stream.time_base), stream=stream)
            except Exception:
                container.seek(0)
        for frame in container.decode(stream):
            if frame.time is not None and frame.time > hi:
                break
            for rf in resampler.resample(frame):
                t0 = float(rf.time) if rf.time is not None else (frame.time or 0.0)
                data = bytes(rf.planes[0])[: rf.samples * 2]
                a = int(max(0.0, lo - t0) * RATE)
                b = int(max(0.0, hi - t0) * RATE)
                if b > 0 and a < rf.samples:
                    out += data[a * 2 : min(b, rf.samples) * 2]
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(out))
    tmp.close()
    return tmp.name, len(out) / 2 / RATE

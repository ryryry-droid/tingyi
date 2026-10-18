"""Chinese text clean-up: script conversion and pinyin."""
from functools import lru_cache

from opencc import OpenCC
from pypinyin import Style, pinyin


@lru_cache(maxsize=2)
def _converter(config: str) -> OpenCC:
    return OpenCC(config)


def to_script(text: str, script: str) -> str:
    """Whisper sometimes mixes scripts; force everything into the one the user chose."""
    return _converter("t2s" if script == "simplified" else "s2t").convert(text)


def to_pinyin(text: str) -> str:
    """'你好，世界' -> 'nǐ hǎo， shì jiè' (punctuation and Latin text kept as-is)."""
    parts = pinyin(text, style=Style.TONE, errors=lambda s: [s])
    return " ".join(p[0] for p in parts).replace(" ，", "，").replace(" 。", "。")

from typing import Literal, Optional

from pydantic import BaseModel, Field

Script = Literal["simplified", "traditional"]
Dialect = Literal["mandarin", "cantonese"]
Style = Literal["natural", "literal"]


class Options(BaseModel):
    """Per-request settings sent by the app."""

    script: Script = "simplified"
    dialect: Dialect = "mandarin"
    style: Style = "natural"
    pinyin: bool = True
    glossary: list[str] = Field(default_factory=list)  # e.g. ["王小明 = Wang Xiaoming", "云计算"]


class RawSegment(BaseModel):
    """What speech recognition produces."""

    start: float
    end: float
    text: str


class Segment(BaseModel):
    """One finished line shown in the app."""

    id: int
    start: float
    end: float
    zh: str
    pinyin: Optional[str] = None
    en: str = ""


class TranslateResponse(BaseModel):
    language: str
    duration: float
    segments: list[Segment]


class RetranslateRequest(BaseModel):
    """Re-translate one line after the user edits its Chinese text."""

    zh: str
    context: list[Segment] = Field(default_factory=list)  # a few lines before it
    options: Options = Field(default_factory=Options)


class RetranslateResponse(BaseModel):
    zh: str
    pinyin: Optional[str] = None
    en: str

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, computed_field, model_validator

Script = Literal["simplified", "traditional"]
Style = Literal["natural", "literal"]
# Spoken languages: Mandarin, Cantonese, Indonesian, English
Source = Literal["zh", "yue", "id", "en"]
# Languages to translate into
Target = Literal["en", "zh", "id"]

LANG_NAMES = {"zh": "Mandarin Chinese", "yue": "Cantonese", "id": "Indonesian (Bahasa Indonesia)", "en": "English"}
CHINESE = {"zh", "yue"}


class Options(BaseModel):
    """Per-request settings sent by the app."""

    source: Optional[Source] = None
    target: Target = "en"
    script: Script = "simplified"  # used whenever Chinese text is shown, on either side
    style: Style = "natural"
    pinyin: bool = True
    glossary: list[str] = Field(default_factory=list)  # e.g. ["王小明 = Wang Xiaoming"]
    dialect: Optional[Literal["mandarin", "cantonese"]] = None  # older app versions

    @model_validator(mode="after")
    def _default_source(self):
        if self.source is None:
            self.source = "yue" if self.dialect == "cantonese" else "zh"
        return self

    @property
    def source_is_chinese(self) -> bool:
        return self.source in CHINESE

    @property
    def target_is_chinese(self) -> bool:
        return self.target == "zh"

    @property
    def same_language(self) -> bool:
        return self.source == self.target


class RawSegment(BaseModel):
    """What speech recognition produces."""

    start: float
    end: float
    text: str


def _legacy_keys(data: Any) -> Any:
    """Accept the original field names (zh/en) from older clients and saved history."""
    if isinstance(data, dict):
        data = dict(data)
        if "text" not in data and "zh" in data:
            data["text"] = data["zh"]
        if "translation" not in data and "en" in data:
            data["translation"] = data["en"]
    return data


class Segment(BaseModel):
    """One finished line shown in the app."""

    id: int
    start: float
    end: float
    text: str  # what was said, in the spoken language
    pinyin: Optional[str] = None  # when the spoken language is Chinese
    translation: str = ""
    translation_pinyin: Optional[str] = None  # when translating into Chinese

    _from_legacy = model_validator(mode="before")(classmethod(lambda cls, d: _legacy_keys(d)))

    # Older clients read these names
    @computed_field
    @property
    def zh(self) -> str:
        return self.text

    @computed_field
    @property
    def en(self) -> str:
        return self.translation


class TranslateResponse(BaseModel):
    source: str
    target: str
    language: str  # same as source; kept for older clients
    title: str = ""  # short summary title; empty if it couldn't be made
    duration: float
    segments: list[Segment]


class RetranslateRequest(BaseModel):
    """Re-translate one line after the user corrects what was said."""

    text: str = ""
    zh: str = ""  # older clients
    context: list[Segment] = Field(default_factory=list)  # a few lines before it
    options: Options = Field(default_factory=Options)


class RetranslateResponse(BaseModel):
    text: str
    pinyin: Optional[str] = None
    translation: str
    translation_pinyin: Optional[str] = None

    @computed_field
    @property
    def zh(self) -> str:
        return self.text

    @computed_field
    @property
    def en(self) -> str:
        return self.translation

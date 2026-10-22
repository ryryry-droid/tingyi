from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, computed_field, model_validator

Script = Literal["simplified", "traditional"]
Style = Literal["natural", "literal"]
# Every language the app offers (users choose which ones they see in Settings).
# Codes are Whisper's language codes.
LANG_NAMES = {
    "zh": "Mandarin Chinese",
    "yue": "Cantonese",
    "id": "Indonesian (Bahasa Indonesia)",
    "ms": "Malay (Bahasa Melayu)",
    "vi": "Vietnamese",
    "en": "English",
    "th": "Thai",
    "tl": "Filipino (Tagalog)",
    "km": "Khmer",
    "ja": "Japanese",
    "ko": "Korean",
    "hi": "Hindi",
    "ta": "Tamil",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "tr": "Turkish",
}
# Spoken languages
Source = Literal["zh", "yue", "id", "ms", "vi", "en", "th", "tl", "km", "ja", "ko", "hi", "ta", "es", "fr", "de", "it", "pt", "ru", "ar", "tr"]
# Languages to translate into (Cantonese is translated into written Chinese)
Target = Literal["en", "zh", "id", "ms", "vi", "th", "tl", "km", "ja", "ko", "hi", "ta", "es", "fr", "de", "it", "pt", "ru", "ar", "tr"]
# Languages whose words can be looked up (everything except English)
LookupLang = Literal["zh", "yue", "id", "ms", "vi", "th", "tl", "km", "ja", "ko", "hi", "ta", "es", "fr", "de", "it", "pt", "ru", "ar", "tr"]
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
    # Set when the transcript is fine but (some of) the translation failed: those lines have no translation
    # yet, and the app can translate just them again instead of throwing the transcript away
    translation_error: str = ""


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


class LookupRequest(BaseModel):
    """Look up a word the user tapped, in the sentence it appeared in."""

    word: str = Field(min_length=1, max_length=40)
    sentence: str = Field(default="", max_length=600)
    lang: LookupLang
    script: Script = "simplified"
    from_english: bool = False  # "word" is English: find how to say it in lang
    sense: str = Field(default="", max_length=80)  # with from_english: which meaning of the English word
    # a meaning that is known to be right (e.g. a Singapore Mandarin term's meaning from the Singaporean
    # Mandarin Database): the entry is written around it and never contradicts it
    known: str = Field(default="", max_length=200)
    strict: bool = True  # think harder and have the entry checked a second time (all word lookups)


class Example(BaseModel):
    text: str
    pinyin: Optional[str] = None
    translation: str


class LookupResponse(BaseModel):
    word: str
    lang: str
    pinyin: Optional[str] = None
    root: str = ""  # Indonesian base word when the tapped word has affixes (e.g. dimakan -> makan)
    part_of_speech: str = ""
    meaning: str
    in_context: str = ""
    notes: str = ""
    example: Optional[Example] = None
    exists: bool = True  # False when it isn't a real word (often a mishearing); see suggestions
    suggestions: list[str] = Field(default_factory=list)  # real words that were probably meant
    register: str = ""  # "colloquial" (slang, informal, everyday speech) or "standard"
    standard: str = ""  # for a colloquial word: its standard form (e.g. gak -> tidak)
    # from English: the English word's different meanings, when they need different words ("track": running
    # track / to follow someone). The first is the one this entry is for.
    senses: list["Sense"] = Field(default_factory=list)


class Sense(BaseModel):
    sense: str  # the English meaning, e.g. "running track (noun)"
    word: str  # the word for it in the language
    pinyin: Optional[str] = None


LookupResponse.model_rebuild()


class FamilyRequest(BaseModel):
    """The other forms of an Indonesian / Malay word: the base word and its affixed forms (tipu, menipu, tertipu...)."""

    word: str = Field(min_length=1, max_length=60)
    lang: Literal["id", "ms"]
    meaning: str = Field(default="", max_length=200)


class FamilyForm(BaseModel):
    word: str
    part_of_speech: str = ""
    meaning: str
    example: Optional[Example] = None


class FamilyResponse(BaseModel):
    base: str
    forms: list[FamilyForm]  # base word first, then the common forms; includes the word asked about


class ExampleRequest(BaseModel):
    """Write the example sentence for a saved word so it says what the user's English sentence says."""

    word: str = Field(min_length=1, max_length=60)
    lang: LookupLang
    script: Script = "simplified"
    meaning: str = Field(default="", max_length=200)
    english: str = Field(min_length=1, max_length=300)


class ThemeWord(BaseModel):
    word: str = Field(min_length=1, max_length=60)
    meaning: str = Field(default="", max_length=200)


class RegisterRequest(BaseModel):
    """Check which saved words are colloquial (for words saved before this was recorded)."""

    lang: LookupLang
    words: list[str] = Field(min_length=1, max_length=100)


class RegisterResult(BaseModel):
    word: str
    register: str
    standard: str = ""


class RegisterResponse(BaseModel):
    results: list[RegisterResult]


class ThemeRequest(BaseModel):
    """Sort saved words into Daily (everyday life) or Technical (work, specialist, formal subjects)."""

    lang: LookupLang
    words: list[ThemeWord] = Field(min_length=1, max_length=100)


class ThemeResult(BaseModel):
    word: str
    theme: Literal["daily", "technical"]


class ThemeResponse(BaseModel):
    results: list[ThemeResult]


class LiveSegment(BaseModel):
    """A transcribed line from a live chunk (translated separately)."""

    start: float  # seconds from the start of the live session
    end: float
    text: str
    pinyin: Optional[str] = None
    lang: str  # spoken language of this line
    target: str  # language it will be translated into


class LiveTranscribeResponse(BaseModel):
    segments: list[LiveSegment]


class LineIn(BaseModel):
    id: int
    text: str


class ContextLine(BaseModel):
    text: str
    translation: str = ""


class LiveTranslateRequest(BaseModel):
    lines: list[LineIn] = Field(min_length=1, max_length=30)
    context: list[ContextLine] = Field(default_factory=list)
    options: Options = Field(default_factory=Options)  # source/target = this batch's direction


class LiveTranslation(BaseModel):
    id: int
    translation: str
    translation_pinyin: Optional[str] = None


class LiveTranslateResponse(BaseModel):
    translations: list[LiveTranslation]


class TitleRequest(BaseModel):
    lines: list[ContextLine] = Field(min_length=1)
    options: Options = Field(default_factory=Options)


class TitleResponse(BaseModel):
    title: str

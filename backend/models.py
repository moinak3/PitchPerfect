from pydantic import BaseModel
from typing import List, Optional, Dict
from enum import Enum


class PitchStatus(str, Enum):
    ON_PITCH = "on_pitch"
    SLIGHTLY_OFF = "slightly_off"
    WAY_OFF = "way_off"
    NO_DATA = "no_data"


class TimingStatus(str, Enum):
    ON_TIME = "on_time"
    SLIGHTLY_OFF = "slightly_off"
    WAY_OFF = "way_off"
    MISSING = "missing"


class WordAnalysis(BaseModel):
    word: str
    pitch_status: PitchStatus
    timing_status: TimingStatus
    user_pitch_hz: Optional[float] = None
    ref_pitch_hz: Optional[float] = None
    onset_delta_ms: Optional[float] = None
    ref_start: float
    ref_end: float


class CoachingNote(BaseModel):
    timestamp: float
    word: str
    issue: str
    suggestion: str
    clip_start: Optional[float] = None      # reference clip window
    clip_end: Optional[float] = None
    user_clip_start: Optional[float] = None  # user clip window (differs for timing errors)
    user_clip_end: Optional[float] = None


class AnalysisResult(BaseModel):
    overall_score: float
    pitch_score: float
    timing_score: float
    dynamics_score: float
    word_breakdown: List[WordAnalysis]
    coaching_notes: List[CoachingNote]
    coaching_report: Dict[str, str]
    pitch_contour: Optional[Dict] = None
    focus_summary: Optional[str] = None


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float

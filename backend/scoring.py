import logging
from typing import List, Dict, Tuple, Optional

import numpy as np

from .models import PitchStatus, TimingStatus, WordAnalysis, CoachingNote
from .audio_utils import (
    get_median_pitch_in_window,
    hz_to_cents_diff,
    hz_to_note_name,
    detect_vibrato,
    extract_pitch,
    extract_rms_envelope,
)
from .alignment import transcribe_with_timestamps, align_word_lists

logger = logging.getLogger(__name__)

# Thresholds
PITCH_ON_CENTS = 50
PITCH_SLIGHT_CENTS = 150
TIMING_ON_MS = 200
TIMING_SLIGHT_MS = 500


def score_pitch(
    ref_words: List[Dict],
    ref_times: List[float],
    ref_hz: List[float],
    user_times: List[float],
    user_hz: List[float],
    time_offset: float = 0.0,
) -> Tuple[float, List[Dict]]:
    """
    Compare pitch frame-by-frame across the user recording, then derive word breakdown.

    For each voiced user frame at time t, look up reference pitch at the same t.
    This approach is language-agnostic and doesn't rely on Whisper word timestamps,
    which are unreliable for non-English / sung audio.
    """
    ref_voiced = sum(
        1 for f in ref_hz
        if f is not None and not (isinstance(f, float) and np.isnan(f)) and f > 0
    )
    user_voiced = sum(
        1 for f in user_hz
        if f is not None and not (isinstance(f, float) and np.isnan(f)) and f > 0
    )
    logger.info(
        "Pitch arrays: ref %d voiced/%d total, user %d voiced/%d total",
        ref_voiced, len(ref_hz), user_voiced, len(user_hz),
    )

    # --- Frame-level overall score ---
    on_pitch_frames = 0
    scored_frames = 0
    user_duration = float(max(user_times)) if user_times else 0.0

    for t, user_f in zip(user_times, user_hz):
        if t > user_duration:
            break
        if user_f is None or (isinstance(user_f, float) and np.isnan(user_f)) or user_f <= 0:
            continue
        ref_f = get_median_pitch_in_window(ref_times, ref_hz, t - 0.05, t + 0.05)
        if ref_f is None:
            continue
        raw_cents = abs(hz_to_cents_diff(user_f, ref_f))
        cents = min(raw_cents, abs(raw_cents - 1200))
        scored_frames += 1
        if cents <= PITCH_ON_CENTS:
            on_pitch_frames += 1

    score = (on_pitch_frames / scored_frames * 100) if scored_frames > 0 else 0.0
    logger.info(
        "Frame-level pitch: %d frames compared, %d on-pitch → %.1f%%",
        scored_frames, on_pitch_frames, score,
    )

    # --- Word-level breakdown (uses ref word timestamps as windows) ---
    word_details = []
    word_on_pitch = 0
    word_scored = 0

    for word in ref_words:
        ref_pitch = get_median_pitch_in_window(
            ref_times, ref_hz, word["start"], word["end"]
        )
        u_start = word["start"] + time_offset
        u_end = word["end"] + time_offset
        user_pitch = get_median_pitch_in_window(
            user_times, user_hz, u_start, u_end
        )

        if ref_pitch is None or user_pitch is None:
            status = PitchStatus.NO_DATA
        else:
            raw_cents = abs(hz_to_cents_diff(user_pitch, ref_pitch))
            cents = min(raw_cents, abs(raw_cents - 1200))
            word_scored += 1
            if cents <= PITCH_ON_CENTS:
                status = PitchStatus.ON_PITCH
                word_on_pitch += 1
            elif cents <= PITCH_SLIGHT_CENTS:
                status = PitchStatus.SLIGHTLY_OFF
            else:
                status = PitchStatus.WAY_OFF

        word_details.append(
            {
                "word": word["word"],
                "pitch_status": status,
                "user_pitch_hz": user_pitch,
                "ref_pitch_hz": ref_pitch,
                "ref_start": word["start"],
                "ref_end": word["end"],
            }
        )

    logger.info(
        "Word-level pitch: %d words total, %d scored, %d on-pitch",
        len(ref_words), word_scored, word_on_pitch,
    )

    # Use frame-level score as the primary score (more reliable for any language).
    # Fall back to word-level score only if frame-level has no data.
    if scored_frames == 0 and word_scored > 0:
        score = (word_on_pitch / word_scored * 100)

    return score, word_details


def score_timing(
    ref_words: List[Dict],
    alignments: List[Dict],
) -> Tuple[float, List[Dict]]:
    """
    Compare word onset times using Whisper-derived alignment.

    A global timing offset is estimated first (median onset_delta across all
    matched words) and subtracted before scoring. This corrects for cases where
    the user's recording starts at a different absolute position in the song
    (e.g. they uploaded a clip that starts at the first lyric, not at t=0).
    The reported per-word delta is therefore the *relative* timing error —
    how much each word rushed or dragged compared to the singer's own average
    entry point — which is the musically meaningful feedback.

    Returns (score_0_to_100, timing_details).
    """
    # Collect raw deltas for matched words
    raw_deltas = [
        aln["onset_delta_ms"]
        for aln in alignments
        if aln.get("onset_delta_ms") is not None
    ]

    # Median global offset (handles recording starting earlier/later than song t=0)
    global_offset_ms = float(np.median(raw_deltas)) if raw_deltas else 0.0
    logger.info(
        "Timing global offset: %.0f ms (median of %d matched words)",
        global_offset_ms, len(raw_deltas),
    )

    timing_details = []
    on_time = 0
    scored = 0

    for aln in alignments:
        ref_idx = aln["ref_word_idx"]
        ref_word = ref_words[ref_idx]
        raw_delta = aln.get("onset_delta_ms")

        if raw_delta is None:
            delta = None
            status = TimingStatus.MISSING
        else:
            # Relative delta: remove the global offset so we score rhythm, not start time
            delta = raw_delta - global_offset_ms
            abs_delta = abs(delta)
            scored += 1
            if abs_delta <= TIMING_ON_MS:
                status = TimingStatus.ON_TIME
                on_time += 1
            elif abs_delta <= TIMING_SLIGHT_MS:
                status = TimingStatus.SLIGHTLY_OFF
            else:
                status = TimingStatus.WAY_OFF

        timing_details.append(
            {
                "word": ref_word["word"],
                "timing_status": status,
                "onset_delta_ms": delta,
                "ref_start": ref_word["start"],
                "ref_end": ref_word["end"],
            }
        )

    score = (on_time / scored * 100) if scored > 0 else 0.0
    return score, timing_details


def score_dynamics(
    ref_rms_times: List[float],
    ref_rms: List[float],
    user_rms_times: List[float],
    user_rms: List[float],
    ref_pitch_times: List[float],
    ref_pitch_hz: List[float],
    user_pitch_times: List[float],
    user_pitch_hz: List[float],
) -> float:
    """
    Compare RMS envelope correlation + vibrato matching.
    Returns score 0–100.
    """
    # Clamp comparison to shorter of the two
    max_time = min(
        max(ref_rms_times) if ref_rms_times else 1,
        max(user_rms_times) if user_rms_times else 1,
    )
    n = min(500, max(10, int(max_time * 10)))
    t_grid = np.linspace(0, max_time, n)

    ref_interp = np.interp(t_grid, ref_rms_times, ref_rms)
    user_interp = np.interp(t_grid, user_rms_times, user_rms)

    ref_std = float(ref_interp.std())
    user_std = float(user_interp.std())

    if ref_std > 1e-9 and user_std > 1e-9:
        corr = float(np.corrcoef(ref_interp, user_interp)[0, 1])
        envelope_score = max(0.0, (corr + 1.0) / 2.0 * 100.0)
    else:
        envelope_score = 50.0

    ref_vibrato = detect_vibrato(ref_pitch_hz, ref_pitch_times)
    user_vibrato = detect_vibrato(user_pitch_hz, user_pitch_times)
    vibrato_diff = abs(ref_vibrato - user_vibrato)
    vibrato_score = max(0.0, (1.0 - vibrato_diff * 2.0) * 100.0)

    return float(envelope_score * 0.60 + vibrato_score * 0.30 + 50.0 * 0.10)


def generate_coaching_notes(
    pitch_details: List[Dict],
    timing_details: List[Dict],
    pitch_score: float,
    timing_score: float,
    dynamics_score: float,
) -> List[CoachingNote]:
    """Generate up to 5 specific, actionable coaching notes."""
    notes: List[CoachingNote] = []

    def fmt_time(sec: float) -> str:
        m, s = int(sec) // 60, int(sec) % 60
        return f"{m}:{s:02d}"

    # Worst pitch issues
    pitch_errors = [
        w
        for w in pitch_details
        if w["pitch_status"] == PitchStatus.WAY_OFF
        and w["user_pitch_hz"] is not None
        and w["ref_pitch_hz"] is not None
    ]
    pitch_errors.sort(
        key=lambda x: abs(hz_to_cents_diff(x["user_pitch_hz"], x["ref_pitch_hz"])),
        reverse=True,
    )
    for issue in pitch_errors[:2]:
        cents = hz_to_cents_diff(issue["user_pitch_hz"], issue["ref_pitch_hz"])
        direction = "flat" if cents < 0 else "sharp"
        user_note = hz_to_note_name(issue["user_pitch_hz"])
        ref_note = hz_to_note_name(issue["ref_pitch_hz"])
        ts = issue["ref_start"]
        clip_start = max(0.0, issue["ref_start"] - 0.5)
        clip_end = issue["ref_end"] + 0.5
        notes.append(
            CoachingNote(
                timestamp=ts,
                word=issue["word"],
                issue=f"Pitch error on '{issue['word']}'",
                suggestion=(
                    f"At {fmt_time(ts)} on '{issue['word']}' you sang {user_note} "
                    f"but the note should be {ref_note} — "
                    f"you were {abs(round(cents))} cents {direction}."
                ),
                clip_start=clip_start,
                clip_end=clip_end,
            )
        )

    # Worst timing issues
    timing_errors = [
        w
        for w in timing_details
        if w["timing_status"] == TimingStatus.WAY_OFF
        and w["onset_delta_ms"] is not None
    ]
    timing_errors.sort(key=lambda x: abs(x["onset_delta_ms"]), reverse=True)
    for issue in timing_errors[:1]:
        delta = issue["onset_delta_ms"]
        direction = "early" if delta < 0 else "late"
        ts = issue["ref_start"]
        word_dur = issue.get("ref_end", ts + 1.0) - ts
        ref_clip_start = max(0.0, ts - 0.5)
        ref_clip_end = ts + word_dur + 0.5
        user_t = ts + delta / 1000.0
        user_clip_start = max(0.0, user_t - 0.5)
        user_clip_end = user_t + word_dur + 0.5
        notes.append(
            CoachingNote(
                timestamp=ts,
                word=issue["word"],
                issue=f"Timing drift on '{issue['word']}'",
                suggestion=(
                    f"At {fmt_time(ts)}, '{issue['word']}' came in "
                    f"{abs(round(delta))} ms {direction}. "
                    "Try to lock in the downbeat more firmly."
                ),
                clip_start=ref_clip_start,
                clip_end=ref_clip_end,
                user_clip_start=user_clip_start,
                user_clip_end=user_clip_end,
            )
        )

    if pitch_score < 60 and len(notes) < 4:
        notes.append(
            CoachingNote(
                timestamp=0.0,
                word="overall",
                issue="General pitch accuracy needs work",
                suggestion=(
                    f"Pitch accuracy was {pitch_score:.0f}%. "
                    "Sing along with just the vocal track first to internalize the melody, "
                    "then switch to the backing track."
                ),
            )
        )

    if timing_score < 60 and len(notes) < 5:
        notes.append(
            CoachingNote(
                timestamp=0.0,
                word="overall",
                issue="Rhythmic timing needs improvement",
                suggestion=(
                    f"Timing accuracy was {timing_score:.0f}%. "
                    "Practice clapping along to the beat before adding lyrics, "
                    "then focus on landing the first syllable of each phrase precisely."
                ),
            )
        )

    if dynamics_score < 55 and len(notes) < 5:
        notes.append(
            CoachingNote(
                timestamp=0.0,
                word="overall",
                issue="Dynamic shaping needs attention",
                suggestion=(
                    f"Dynamics scored {dynamics_score:.0f}%. "
                    "Pay attention to where the original vocalist swells and recedes — "
                    "mirror those energy shifts in your own performance."
                ),
            )
        )

    return notes[:5]


def _pitch_examples(pitch_details: List[Dict], n: int = 3) -> List[Dict]:
    errors = [
        w for w in pitch_details
        if w["pitch_status"] == PitchStatus.WAY_OFF
        and w.get("user_pitch_hz") and w.get("ref_pitch_hz")
    ]
    errors.sort(
        key=lambda x: abs(hz_to_cents_diff(x["user_pitch_hz"], x["ref_pitch_hz"])),
        reverse=True,
    )
    out = []
    for w in errors[:n]:
        cents = hz_to_cents_diff(w["user_pitch_hz"], w["ref_pitch_hz"])
        direction = "flat" if cents < 0 else "sharp"
        ts = w["ref_start"]
        out.append({
            "word": w["word"],
            "timestamp": ts,
            "clip_start": max(0.0, ts - 0.5),
            "clip_end": w["ref_end"] + 0.5,
            "description": (
                f"'{w['word']}': you sang {hz_to_note_name(w['user_pitch_hz'])} "
                f"but the target was {hz_to_note_name(w['ref_pitch_hz'])} "
                f"— {abs(round(cents))} cents {direction}"
            ),
        })
    return out


def _timing_examples(timing_details: List[Dict], n: int = 3) -> List[Dict]:
    def fmt(sec: float) -> str:
        m, s = int(sec) // 60, int(sec) % 60
        return f"{m}:{s:02d}"

    errors = [
        w for w in timing_details
        if w["timing_status"] == TimingStatus.WAY_OFF
        and w.get("onset_delta_ms") is not None
    ]
    errors.sort(key=lambda x: abs(x["onset_delta_ms"]), reverse=True)
    out = []
    for w in errors[:n]:
        delta = w["onset_delta_ms"]
        direction = "early" if delta < 0 else "late"
        abs_delta_ms = abs(round(delta))
        abs_delta_s = abs_delta_ms / 1000.0
        ts = w["ref_start"]
        word_dur = max(w.get("ref_end", ts + 1.0) - ts, 0.3)
        user_t = ts + delta / 1000.0

        # Widen clips so the listener has context: 1 s before + word + 1 s after
        ref_clip_start = max(0.0, ts - 1.0)
        ref_clip_end = ts + word_dur + 1.0
        user_clip_start = max(0.0, user_t - 1.0)
        user_clip_end = user_t + word_dur + 1.0

        if abs_delta_ms >= 1000:
            delta_str = f"{abs_delta_s:.1f} seconds"
        else:
            delta_str = f"{abs_delta_ms} ms"

        description = (
            f"'{w['word']}' at {fmt(ts)}: you came in {delta_str} {direction} of where "
            f"the reference sings it. "
            f"The reference clip starts at {fmt(ts)} — listen for when the word lands. "
            f"Your clip starts at {fmt(user_t)} — notice the {direction} entry."
        )
        out.append({
            "word": w["word"],
            "timestamp": ts,
            "clip_start": ref_clip_start,
            "clip_end": ref_clip_end,
            "user_clip_start": user_clip_start,
            "user_clip_end": user_clip_end,
            "description": description,
            "delta_str": delta_str,
            "direction": direction,
        })
    return out


def _dynamics_examples(
    ref_rms_times: List[float],
    ref_rms: List[float],
    user_rms_times: List[float],
    user_rms: List[float],
    user_duration: float,
    n: int = 3,
) -> List[Dict]:
    if not ref_rms_times or not user_rms_times:
        return []
    max_t = min(user_duration, float(max(ref_rms_times)))
    if max_t < 10:
        return []

    n_pts = max(60, int(max_t * 4))
    t_grid = np.linspace(2.0, max_t - 2.0, n_pts)
    ref_i = np.interp(t_grid, ref_rms_times, ref_rms)
    user_i = np.interp(t_grid, user_rms_times, user_rms)

    ref_peak = float(ref_i.max())
    user_peak = float(user_i.max())
    if ref_peak < 1e-6 or user_peak < 1e-6:
        return []

    diff = (user_i / user_peak) - (ref_i / ref_peak)  # + = user too loud, - = user too quiet

    examples: List[Dict] = []
    used: List[float] = []

    for polarity, make_desc in [
        (-1, lambda t: (
            f"At {int(t)//60}:{int(t)%60:02d} the reference builds with energy "
            "but your recording stayed flat — push your volume and intensity here."
        )),
        (1, lambda t: (
            f"At {int(t)//60}:{int(t)%60:02d} the song is soft and intimate "
            "but you were louder than the reference — pull back and let the verse breathe."
        )),
    ]:
        curve = polarity * diff
        ranked = sorted(range(len(curve)), key=lambda i: curve[i], reverse=True)
        for idx in ranked:
            if curve[idx] < 0.25:
                break
            t = float(t_grid[idx])
            if any(abs(t - u) < 8 for u in used):
                continue
            used.append(t)
            examples.append({
                "timestamp": t,
                "clip_start": max(0.0, t - 1.0),
                "clip_end": min(max_t, t + 3.0),
                "description": make_desc(t),
            })
            if len(examples) >= n:
                break
        if len(examples) >= n:
            break

    return sorted(examples, key=lambda x: x["timestamp"])


def _dynamics_tactical_tips(
    dynamics_score: float,
    ref_rms: List[float],
    user_rms: List[float],
    ref_pitch_hz: List[float],
    ref_pitch_times: List[float],
    user_pitch_hz: List[float],
    user_pitch_times: List[float],
) -> List[str]:
    tips: List[str] = []

    ref_arr = np.array([v for v in ref_rms if v is not None], dtype=float)
    user_arr = np.array([v for v in user_rms if v is not None], dtype=float)
    ref_std = float(ref_arr.std()) if len(ref_arr) > 1 else 0.0
    user_std = float(user_arr.std()) if len(user_arr) > 1 else 0.0

    if ref_std > 1e-6:
        ratio = user_std / ref_std
        if ratio < 0.6:
            tips.append(
                f"Your dynamic range is compressed (your variation is {ratio:.0%} of the reference). "
                "Exaggerate the contrast between loud and soft passages — "
                "push harder in the chorus and whisper in the verse."
            )
        elif ratio > 1.5:
            tips.append(
                "Your volume swings more than the reference. "
                "Aim to mirror the reference's energy arc rather than adding extra dynamics of your own."
            )

    ref_vibrato = detect_vibrato(ref_pitch_hz, ref_pitch_times)
    user_vibrato = detect_vibrato(user_pitch_hz, user_pitch_times)
    if ref_vibrato > 0.25 and user_vibrato < ref_vibrato * 0.5:
        tips.append(
            "The reference singer uses prominent vibrato on sustained notes. "
            "On any note held longer than half a second, try oscillating your pitch "
            "±20–30 cents at about 5–6 Hz. Practise on a single long note first."
        )

    tips.append(
        "Listen to the original focusing only on volume — ignore the lyrics and melody. "
        "Mark on the lyrics where the singer swells, softens, or goes breathy, "
        "then consciously mirror those changes when you re-record."
    )
    tips.append(
        "Record yourself and listen back with headphones. "
        "Compare your energy at the verse versus the chorus — "
        "most songs need at least a 30–40% volume increase into the chorus to feel natural."
    )
    if dynamics_score < 55:
        tips.append(
            "Work on breath support: strong, consistent airflow lets you control "
            "crescendos and decrescendos smoothly. "
            "Practise the hissing exercise — exhale a steady hiss for 20 seconds "
            "maintaining even pressure throughout."
        )

    return tips[:5]


def generate_coaching_report(
    pitch_score: float,
    timing_score: float,
    dynamics_score: float,
    pitch_details: List[Dict],
    timing_details: List[Dict],
    ref_rms_times: List[float],
    ref_rms_values: List[float],
    user_rms_times: List[float],
    user_rms_values: List[float],
    ref_pitch_hz: List[float],
    ref_pitch_times: List[float],
    user_pitch_hz: List[float],
    user_pitch_times: List[float],
    user_duration: float,
) -> Dict:
    def pitch_para() -> str:
        if pitch_score >= 85:
            return (
                f"Excellent intonation at {pitch_score:.0f}%! Your pitch accuracy is strong. "
                "Focus on maintaining consistency across longer sustained notes and phrase endings."
            )
        if pitch_score >= 65:
            return (
                f"Pitch accuracy is {pitch_score:.0f}% — a solid foundation. "
                "Notes are drifting in the middle and tail of phrases. "
                "Try sustaining the vowel sound longer and listening for the target pitch "
                "before moving to the next note."
            )
        return (
            f"Pitch accuracy was {pitch_score:.0f}%, with room for significant improvement. "
            "Practice with a piano: sing a note, then play it to verify. "
            "Interval and ear training will help your pitch memory."
        )

    def timing_para() -> str:
        if timing_score >= 85:
            return (
                f"Your timing is tight at {timing_score:.0f}%! You're locking in with the rhythm well. "
                "Minor variations give the performance a natural human feel."
            )
        if timing_score >= 65:
            return (
                f"Timing accuracy was {timing_score:.0f}%. You're generally on beat but occasionally rushing. "
                "Practice with a metronome at 80% tempo and work up gradually."
            )
        return (
            f"Timing accuracy of {timing_score:.0f}% suggests difficulty staying with the rhythm. "
            "Speak the lyrics in rhythm before singing — tap your foot on each beat "
            "and count through rests."
        )

    def dynamics_para() -> str:
        ref_arr = np.array([v for v in ref_rms_values if v is not None], dtype=float)
        user_arr = np.array([v for v in user_rms_values if v is not None], dtype=float)
        ref_std = float(ref_arr.std()) if len(ref_arr) > 1 else 0.0
        user_std = float(user_arr.std()) if len(user_arr) > 1 else 0.0
        ref_vibrato = detect_vibrato(ref_pitch_hz, ref_pitch_times)
        user_vibrato = detect_vibrato(user_pitch_hz, user_pitch_times)

        issues = []
        if ref_std > 1e-6 and user_std / ref_std < 0.6:
            issues.append("your dynamic range is too compressed")
        if ref_vibrato > 0.25 and user_vibrato < ref_vibrato * 0.5:
            issues.append("vibrato on sustained notes is missing")
        if dynamics_score < 60:
            issues.append("the energy arc of the song isn't being tracked closely enough")

        if not issues:
            return (
                f"Dynamics and feel scored {dynamics_score:.0f}%. "
                "You're mirroring the energy arc well. "
                "Keep working on breath support and vibrato depth to close the remaining gap."
            )
        return (
            f"Dynamics scored {dynamics_score:.0f}%. "
            f"What held you back: {'; '.join(issues)}. "
            "The examples below show specific moments where the divergence is most audible."
        )

    return {
        "pitch": {
            "paragraph": pitch_para(),
            "examples": _pitch_examples(pitch_details),
        },
        "timing": {
            "paragraph": timing_para(),
            "examples": _timing_examples(timing_details),
        },
        "dynamics": {
            "paragraph": dynamics_para(),
            "tactical_tips": _dynamics_tactical_tips(
                dynamics_score,
                ref_rms_values, user_rms_values,
                ref_pitch_hz, ref_pitch_times,
                user_pitch_hz, user_pitch_times,
            ),
            "examples": _dynamics_examples(
                ref_rms_times, ref_rms_values,
                user_rms_times, user_rms_values,
                user_duration,
            ),
        },
    }


def _focus_summary(
    pitch_score: float,
    timing_score: float,
    dynamics_score: float,
    pitch_details: List[Dict],
    timing_details: List[Dict],
) -> str:
    scores = [("Pitch", pitch_score), ("Timing", timing_score), ("Dynamics", dynamics_score)]
    scores.sort(key=lambda x: x[1])
    worst_name, worst_score = scores[0]
    best_name, best_score = scores[2]

    parts = []

    if worst_name == "Pitch":
        way_off = sum(1 for w in pitch_details if w["pitch_status"] == PitchStatus.WAY_OFF)
        parts.append(
            f"Pitch accuracy ({pitch_score:.0f}%) is your biggest challenge this attempt"
            + (f" — {way_off} notes were significantly off-target" if way_off >= 3 else "")
            + "."
        )
        if worst_score < 60:
            parts.append(
                "For your next attempt: slow down and match the melody note-for-note — "
                "listen to the reference closely and lock onto each note before moving to the next."
            )
        else:
            parts.append(
                "For your next attempt: check the NOTABLE MOMENTS in the Pitch Accuracy section "
                "and specifically target those words."
            )
    elif worst_name == "Timing":
        way_off = sum(1 for w in timing_details if w["timing_status"] == TimingStatus.WAY_OFF)
        parts.append(
            f"Timing ({timing_score:.0f}%) is your biggest challenge this attempt"
            + (f" — {way_off} words had significant drift" if way_off >= 3 else "")
            + "."
        )
        if worst_score < 60:
            parts.append(
                "For your next attempt: speak the lyrics in rhythm first before singing, "
                "and focus on landing the first syllable of each phrase precisely on the beat."
            )
        else:
            parts.append(
                "For your next attempt: check the timing examples below to see if you're "
                "consistently early or late, then consciously adjust."
            )
    else:
        parts.append(
            f"Dynamics & feel ({dynamics_score:.0f}%) is your main growth area this attempt. "
            "Your pitch and timing are solid — now focus on matching the energy arc of the original."
        )
        parts.append(
            "For your next attempt: listen to the volume and intensity of the reference, "
            "and consciously mirror where it swells and pulls back."
        )

    if best_score >= 75:
        parts.append(
            f"Your {best_name.lower()} is your strongest dimension at {best_score:.0f}% — keep that up."
        )

    return " ".join(parts)


def _downsample_pitch(
    times: List[float], hz: List[float], max_pts: int = 500
) -> Tuple[List[float], List[float]]:
    """Return only voiced frames, downsampled to at most max_pts points."""
    voiced_t, voiced_hz = [], []
    for t, f in zip(times, hz):
        if f is not None and not (isinstance(f, float) and np.isnan(f)) and f > 0:
            voiced_t.append(round(float(t), 3))
            voiced_hz.append(round(float(f), 1))
    if len(voiced_t) <= max_pts:
        return voiced_t, voiced_hz
    step = max(1, len(voiced_t) // max_pts)
    return voiced_t[::step], voiced_hz[::step]


def analyze_performance(ref_data: Dict, user_audio_path: str) -> Dict:
    """Full analysis pipeline. Run in a thread pool (blocking)."""
    logger.info("Extracting user pitch...")
    user_pitch_times, user_pitch_hz, _ = extract_pitch(user_audio_path, denoise=True)

    logger.info("Extracting user RMS envelope...")
    user_rms_times, user_rms_values = extract_rms_envelope(user_audio_path)

    logger.info("Transcribing user vocal...")
    language = ref_data.get("language")
    user_words = transcribe_with_timestamps(user_audio_path, language=language)

    ref_words = ref_data["words"]
    ref_pitch_times = ref_data["pitch_times"]
    ref_pitch_hz = ref_data["pitch_hz"]
    ref_rms_times = ref_data["rms_times"]
    ref_rms_values = ref_data["rms_values"]

    # Both recordings start at t=0 (the frontend sets audioRef.currentTime=0
    # before starting the MediaRecorder), so no offset correction is needed.
    user_duration = float(max(user_pitch_times)) if user_pitch_times else 0.0
    ref_duration = float(max(ref_pitch_times)) if ref_pitch_times else 0.0
    words_in_window = sum(1 for w in ref_words if w["start"] <= user_duration)
    logger.info(
        "User recording: %.1fs  |  Reference: %.1fs  |  Ref words in user window: %d/%d",
        user_duration, ref_duration, words_in_window, len(ref_words),
    )
    if words_in_window < 10:
        logger.warning(
            "Only %d reference words fall within the %.1fs user recording. "
            "The song likely has vocals mostly after t=%.0fs. "
            "User should record more of the song.",
            words_in_window, user_duration, user_duration,
        )

    logger.info("Scoring pitch...")
    pitch_score, pitch_details = score_pitch(
        ref_words, ref_pitch_times, ref_pitch_hz,
        user_pitch_times, user_pitch_hz,
        time_offset=0.0,
    )

    logger.info("Aligning word lists for timing...")
    alignments = align_word_lists(ref_words, user_words)

    logger.info("Scoring timing...")
    timing_score, timing_details = score_timing(ref_words, alignments)

    logger.info("Scoring dynamics...")
    dynamics_score = score_dynamics(
        ref_rms_times, ref_rms_values,
        user_rms_times, user_rms_values,
        ref_pitch_times, ref_pitch_hz,
        user_pitch_times, user_pitch_hz,
    )

    # Merge into word-level breakdown
    timing_by_word: Dict[str, Dict] = {}
    for td in timing_details:
        key = td["word"].lower()
        if key not in timing_by_word:
            timing_by_word[key] = td

    word_breakdown = []
    for pd in pitch_details:
        key = pd["word"].lower()
        td = timing_by_word.get(key, {})
        word_breakdown.append(
            WordAnalysis(
                word=pd["word"],
                pitch_status=pd["pitch_status"],
                timing_status=td.get("timing_status", TimingStatus.MISSING),
                user_pitch_hz=pd.get("user_pitch_hz"),
                ref_pitch_hz=pd.get("ref_pitch_hz"),
                onset_delta_ms=td.get("onset_delta_ms"),
                ref_start=pd["ref_start"],
                ref_end=pd["ref_end"],
            )
        )

    overall_score = pitch_score * 0.45 + timing_score * 0.35 + dynamics_score * 0.20

    coaching_notes = generate_coaching_notes(
        pitch_details, timing_details,
        pitch_score, timing_score, dynamics_score,
    )
    coaching_report = generate_coaching_report(
        pitch_score, timing_score, dynamics_score,
        pitch_details, timing_details,
        ref_rms_times, ref_rms_values,
        user_rms_times, user_rms_values,
        ref_pitch_hz, ref_pitch_times,
        user_pitch_hz, user_pitch_times,
        user_duration,
    )

    focus_summary = _focus_summary(
        pitch_score, timing_score, dynamics_score,
        pitch_details, timing_details,
    )

    ref_t_down, ref_hz_down = _downsample_pitch(ref_pitch_times, ref_pitch_hz)
    user_t_down, user_hz_down = _downsample_pitch(user_pitch_times, user_pitch_hz)

    return {
        "overall_score": round(overall_score, 1),
        "pitch_score": round(pitch_score, 1),
        "timing_score": round(timing_score, 1),
        "dynamics_score": round(dynamics_score, 1),
        "word_breakdown": [w.model_dump() for w in word_breakdown],
        "coaching_notes": [n.model_dump() for n in coaching_notes],
        "coaching_report": coaching_report,
        "focus_summary": focus_summary,
        "pitch_contour": {
            "ref_times": ref_t_down,
            "ref_hz": ref_hz_down,
            "user_times": user_t_down,
            "user_hz": user_hz_down,
        },
    }

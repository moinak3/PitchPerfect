import logging
import os
from difflib import SequenceMatcher
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

_whisper_model = None


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        import whisper
        size = os.environ.get("WHISPER_MODEL", "base")
        logger.info("Loading Whisper model (%s)...", size)
        _whisper_model = whisper.load_model(size)
        logger.info("Whisper model loaded.")
    return _whisper_model


def detect_language(audio_path: str) -> str:
    """
    Detect language by sampling three windows (start, 1/3, 2/3 of the audio)
    and picking the most confident result. Avoids misdetection from instrumental intros.
    """
    import whisper
    model = get_whisper_model()
    full_audio = whisper.load_audio(audio_path)
    duration = len(full_audio) / 16000  # whisper uses 16kHz

    offsets = [0.0, duration / 3, 2 * duration / 3]
    lang_scores: Dict[str, float] = {}

    for offset in offsets:
        start = int(offset * 16000)
        chunk = full_audio[start : start + 16000 * 30]
        chunk = whisper.pad_or_trim(chunk)
        mel = whisper.log_mel_spectrogram(chunk).to(model.device)
        _, probs = model.detect_language(mel)
        best = max(probs, key=probs.get)
        lang_scores[best] = lang_scores.get(best, 0.0) + probs[best]

    lang = max(lang_scores, key=lang_scores.get)
    logger.info("Detected language '%s' from %s (sampled %d windows)", lang, audio_path, len(offsets))
    return lang


def transcribe_with_timestamps(
    audio_path: str,
    language: str = None,
    initial_prompt: str = None,
) -> List[Dict]:
    """
    Transcribe audio with Whisper and return word-level timestamps.
    If language is None, auto-detects from the audio.
    initial_prompt: optional lyrics text to guide Whisper toward correct words.
    Returns list of {"word": str, "start": float, "end": float}.
    """
    model = get_whisper_model()

    if language is None:
        language = detect_language(audio_path)

    kwargs = dict(
        word_timestamps=True,
        language=language,
        verbose=False,
        condition_on_previous_text=False,
    )
    if initial_prompt:
        kwargs["initial_prompt"] = initial_prompt
        logger.info("Transcribing with lyrics prompt (%d chars)", len(initial_prompt))

    result = model.transcribe(audio_path, **kwargs)

    words = []
    for segment in result.get("segments", []):
        for w in segment.get("words", []):
            text = w.get("word", "").strip()
            start = float(w["start"])
            end = float(w["end"])
            if text and (end - start) >= 0.05:  # drop zero/near-zero duration tokens
                words.append({"word": text, "start": start, "end": end})

    logger.info("Transcribed %d words (lang=%s) from %s", len(words), language, audio_path)
    return words


def _normalize_word(w: str) -> str:
    return w.lower().strip(".,!?'\"-()[]{}:;")


def _do_alignment(
    ref_words: List[Dict],
    ref_norm: List[str],
    user_words: List[Dict],
    user_norm: List[str],
    time_offset_s: float = 0.0,
    window_s: float = 20.0,
) -> Dict[int, int]:
    """
    Core greedy word matcher.  user timestamps are shifted by *time_offset_s*
    before proximity scoring so that the caller can pass a pre-computed global
    offset.  Returns user_to_ref mapping.
    """
    used_ref: set = set()
    user_to_ref: Dict[int, int] = {}

    for u_idx, u_word in enumerate(user_norm):
        u_time = user_words[u_idx]["start"] + time_offset_s

        best_ref_idx: Optional[int] = None
        best_score = -1.0

        for r_idx, r_word in enumerate(ref_norm):
            if r_idx in used_ref:
                continue

            r_time = ref_words[r_idx]["start"]
            if abs(r_time - u_time) > window_s:
                continue

            text_sim = (
                SequenceMatcher(None, u_word, r_word).ratio()
                if u_word and r_word
                else 0.0
            )
            time_score = max(0.0, 1.0 - abs(r_time - u_time) / max(window_s / 2, 1.0))

            score = text_sim * 0.7 + time_score * 0.3
            if score > best_score and score > 0.45:
                best_score = score
                best_ref_idx = r_idx

        if best_ref_idx is not None:
            user_to_ref[u_idx] = best_ref_idx
            used_ref.add(best_ref_idx)

    return user_to_ref


def align_word_lists(
    ref_words: List[Dict], user_words: List[Dict]
) -> List[Dict]:
    """
    Match user words to reference words using fuzzy text similarity + time proximity.

    Two-pass approach:
      Pass 1 — wide window (±20 s) with no offset to get an initial set of matches.
               Compute median raw delta → global_offset (accounts for recordings
               that start earlier/later than t=0 of the reference).
      Pass 2 — narrow window (±4 s) with user timestamps shifted by global_offset.
               Produces much tighter, correct matches.

    Each user word is matched to at most one ref word; each ref word to at most one
    user word.  Returns a list (one entry per ref word) with onset_delta_ms for
    matched words.  onset_delta_ms is the *raw* delta (not offset-corrected);
    score_timing() applies the global offset correction when scoring.
    """
    import statistics

    if not user_words:
        return [
            {"ref_word_idx": i, "user_word_idx": None, "onset_delta_ms": None, "matched": False}
            for i in range(len(ref_words))
        ]

    user_norm = [_normalize_word(w["word"]) for w in user_words]
    ref_norm = [_normalize_word(w["word"]) for w in ref_words]

    # ── Pass 1: wide window, no offset ──────────────────────────────────────
    rough_map = _do_alignment(ref_words, ref_norm, user_words, user_norm, time_offset_s=0.0, window_s=20.0)

    raw_deltas = [
        (user_words[u]["start"] - ref_words[r]["start"])
        for u, r in rough_map.items()
    ]
    if raw_deltas:
        global_offset_s = statistics.median(raw_deltas)
    else:
        global_offset_s = 0.0

    logger.info(
        "Pass-1 alignment: %d matches, global offset = %.2f s", len(rough_map), global_offset_s
    )

    # ── Pass 2: tight window, offset-corrected user timestamps ──────────────
    fine_map = _do_alignment(
        ref_words, ref_norm, user_words, user_norm,
        time_offset_s=-global_offset_s,   # shift user times toward ref times
        window_s=4.0,
    )

    logger.info("Pass-2 alignment: %d matches (window ±4 s)", len(fine_map))

    ref_to_user: Dict[int, int] = {r: u for u, r in fine_map.items()}

    alignments = []
    for r_idx in range(len(ref_words)):
        if r_idx in ref_to_user:
            u_idx = ref_to_user[r_idx]
            onset_delta_ms = (
                user_words[u_idx]["start"] - ref_words[r_idx]["start"]
            ) * 1000.0
            alignments.append(
                {
                    "ref_word_idx": r_idx,
                    "user_word_idx": u_idx,
                    "onset_delta_ms": float(onset_delta_ms),
                    "matched": True,
                }
            )
        else:
            alignments.append(
                {
                    "ref_word_idx": r_idx,
                    "user_word_idx": None,
                    "onset_delta_ms": None,
                    "matched": False,
                }
            )

    matched = sum(1 for a in alignments if a["matched"])
    logger.info(
        "Word alignment: %d user words → %d/%d ref words matched (global offset %.2f s)",
        len(user_words), matched, len(ref_words), global_offset_s,
    )
    return alignments

import os
import math
import subprocess
import uuid
import logging
from pathlib import Path
from typing import Tuple, List, Optional

import numpy as np
import librosa
import soundfile as sf

logger = logging.getLogger(__name__)

TEMP_DIR = Path(os.environ.get("PP_TEMP_DIR", "./temp"))
SR = 16000
HOP_LENGTH = 512
FRAME_LENGTH = 2048


def normalize_audio(audio_path: str, out_path: Optional[str] = None) -> str:
    """Load audio file and resample to 16kHz mono WAV."""
    y, _ = librosa.load(audio_path, sr=SR, mono=True)
    if out_path is None:
        out_path = str(Path(audio_path).parent / f"{Path(audio_path).stem}_16k.wav")
    sf.write(out_path, y, SR)
    return out_path


def download_youtube(url: str, job_id: str) -> str:
    """Download audio from YouTube URL and return path to normalized WAV.

    Uses yt-dlp with browser cookies (stored on the Modal Volume) to pass
    YouTube's bot check. nodejs is available in the container for nsig solving.
    """
    import shutil, sys

    out_dir = TEMP_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    wav_out = str(out_dir / "original.wav")

    ytdlp_bin = shutil.which("yt-dlp") or str(Path(sys.executable).parent / "yt-dlp")

    # Cookies uploaded to the Modal Volume bypass YouTube's cloud-IP bot check.
    # Upload with: modal volume put pitchperfect-data ~/Downloads/youtube.com_cookies.txt /youtube_cookies.txt
    data_root = Path(os.environ.get("PP_TEMP_DIR", "./temp")).parent
    cookies_path = data_root / "youtube_cookies.txt"
    cookie_args = ["--cookies", str(cookies_path)] if cookies_path.exists() else []
    if not cookie_args:
        logger.warning("[%s] No youtube_cookies.txt on Volume — download may be blocked", job_id)

    cmd = [
        ytdlp_bin,
        "-x",
        "--audio-format", "wav",
        "--audio-quality", "0",
        # Tell yt-dlp to use the installed nodejs for nsig challenge solving.
        # Without this, yt-dlp defaults to deno (not installed) and audio formats are missing.
        "--js-runtimes", "node",
        *cookie_args,
        "-o", str(out_dir / "original.%(ext)s"),
        "--no-playlist",
        "--retries", "3",
        url,
    ]

    logger.info("[%s] yt-dlp: %s", job_id, " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed:\n{result.stderr[-800:]}")

    audio_exts = {".wav", ".mp3", ".m4a", ".webm", ".opus", ".ogg", ".aac"}
    candidates = [p for p in out_dir.iterdir() if p.suffix in audio_exts and p.stem == "original"]
    if not candidates:
        candidates = [p for p in out_dir.iterdir() if p.suffix in audio_exts]
    if not candidates:
        raise RuntimeError(f"No audio file found after yt-dlp.\nstdout: {result.stdout[-300:]}")

    return normalize_audio(str(candidates[0]), wav_out)

def separate_vocals(
    audio_path: str, job_id: str, update_fn=None
) -> Tuple[str, str]:
    """
    Use demucs htdemucs to separate vocals and backing track.
    Returns (vocals_path, backing_path).
    """
    out_dir = TEMP_DIR / job_id / "separated"
    out_dir.mkdir(parents=True, exist_ok=True)

    if update_fn:
        update_fn("Running demucs vocal separation (htdemucs)...")

    result = subprocess.run(
        [
            "python", "-m", "demucs",
            "--two-stems=vocals",
            "-n", "htdemucs",
            "--out", str(out_dir),
            audio_path,
        ],
        capture_output=True,
        text=True,
        timeout=900,
    )

    if result.returncode != 0:
        # Strip tqdm progress bars (lines with \r or containing MB/s) to surface real error
        stderr_lines = [
            l for l in result.stderr.splitlines()
            if "MB/s" not in l and "B/s" not in l and "|" not in l
        ]
        clean_err = "\n".join(stderr_lines[-30:]) or result.stderr[-800:]
        logger.error("Demucs failed (rc=%d):\n%s", result.returncode, clean_err)
        raise RuntimeError(f"Demucs failed:\n{clean_err}")

    # Search for output files — demucs nests them under model/stem_name/
    vocals_path: Optional[Path] = None
    backing_path: Optional[Path] = None

    for p in out_dir.rglob("vocals.wav"):
        vocals_path = p
    for p in out_dir.rglob("no_vocals.wav"):
        backing_path = p

    if not vocals_path or not vocals_path.exists():
        raise RuntimeError(
            f"Vocals file not found after demucs. Check {out_dir}. "
            f"Demucs stdout: {result.stdout[:300]}"
        )

    if not backing_path or not backing_path.exists():
        raise RuntimeError("no_vocals.wav not found after demucs separation")

    # Both tracks: 16kHz mono WAV.
    # WAV has zero encoder delay, which is critical for word-highlight sync —
    # MP3's LAME encoder prepends ~25-50 ms of padding that browsers don't
    # always strip, causing word timestamps to appear consistently early.
    norm_vocals = str(TEMP_DIR / job_id / "vocals_16k.wav")
    norm_backing = str(TEMP_DIR / job_id / "backing_16k.wav")
    normalize_audio(str(vocals_path), norm_vocals)
    normalize_audio(str(backing_path), norm_backing)

    return norm_vocals, norm_backing


def extract_pitch_pyin(audio_path: str) -> Tuple[List[float], List[float], List[float]]:
    """
    Extract pitch using librosa pyin (probabilistic YIN).
    More robust than CREPE for complex/ornamented singing styles (e.g. Indian classical).
    Used for the reference vocal track.
    """
    y, _ = librosa.load(audio_path, sr=SR, mono=True)
    hop_length = 160  # 10 ms at 16 kHz

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=float(librosa.note_to_hz("C2")),   # ~65 Hz
        fmax=float(librosa.note_to_hz("C7")),   # ~2093 Hz
        sr=SR,
        hop_length=hop_length,
    )

    times = librosa.times_like(f0, sr=SR, hop_length=hop_length)
    voiced_count = int(np.sum(~np.isnan(f0)))
    logger.info(
        "pyin: %d total frames, %d voiced (%.0f%%) from %s",
        len(f0), voiced_count,
        100 * voiced_count / len(f0) if len(f0) else 0,
        audio_path,
    )
    return times.tolist(), f0.tolist(), voiced_prob.tolist()


def detect_vocal_sections(
    times: List[float],
    hz: List[float],
    conf: List[float],
    conf_threshold: float = 0.2,
    gap_s: float = 2.0,
    min_frames: int = 25,
) -> Tuple[List[Tuple[float, float]], float]:
    """
    Locate where the singer is actually singing in the reference vocal track.

    pyin reports a pitch for *every* frame, including instrument bleed-through
    that demucs failed to fully remove.  Bleed sits at the confidence floor
    (~0.01), while genuine voiced singing produces confidence peaks well above
    0.2.  We therefore:

      1. Keep only confident voiced frames (conf >= conf_threshold).
      2. Group them into sections, splitting wherever there is a silence /
         instrumental gap longer than gap_s seconds.
      3. Treat a section as "real singing" only if it contains at least
         min_frames confident frames (filters out brief background blips).

    Returns:
        (sections, vocal_start_time)
        sections          — list of (start_s, end_s) for substantial sections
        vocal_start_time  — start of the first substantial section, else 0.0
    """
    confident_times = [
        times[i]
        for i in range(len(times))
        if hz[i] is not None
        and not (isinstance(hz[i], float) and math.isnan(hz[i]))
        and hz[i] > 0
        and (conf[i] if i < len(conf) else 1.0) >= conf_threshold
    ]
    if not confident_times:
        return [], 0.0

    sections: List[Tuple[float, float, int]] = []
    s_start = s_end = confident_times[0]
    s_len = 1
    for t in confident_times[1:]:
        if t - s_end > gap_s:
            sections.append((s_start, s_end, s_len))
            s_start = t
            s_len = 1
        else:
            s_len += 1
        s_end = t
    sections.append((s_start, s_end, s_len))

    substantial = [(a, b) for (a, b, n) in sections if n >= min_frames]
    vocal_start = substantial[0][0] if substantial else 0.0
    return substantial, vocal_start


def refine_word_onsets(
    words: List[dict],
    pitch_times: List[float],
    pitch_conf: List[float],
    rms_times: List[float],
    rms_values: List[float],
    pre: float = 0.0,
    post: float = 0.6,
    conf_threshold: float = 0.2,
) -> List[dict]:
    """
    Snap each Whisper word's start to its actual ACOUSTIC onset.

    Why: on sustained singing Whisper's word_timestamps mark the start of the
    decoded segment containing the word, which can precede the audible
    articulation by 200-500 ms (or more on slow ballads).  We refine each
    word.start by searching a window [start - pre, start + post] for the first
    moment that's audibly the word: either pitch confidence crosses
    ``conf_threshold`` (clear voiced singing begins) or, failing that, the RMS
    envelope rises clearly above local background.  The earlier of the two is
    chosen, monotonically constrained against the previous word.

    Word ends are then patched so mid-phrase words remain contiguous (each
    word's end = the next word's refined start); ORIGINAL pauses (where
    Whisper itself had a gap) are preserved.

    Args:
        words:        Whisper words with float start/end and string word.
        pitch_times, pitch_conf:  pyin output (sorted by time).
        rms_times, rms_values:    RMS envelope (sorted by time).
        pre, post:    seconds we're willing to shift the start earlier / later.
        conf_threshold: pyin confidence above which we call a frame voiced.

    Returns:
        New list of {word, start, end} dicts with refined starts/ends.
    """
    import bisect

    if not words or not pitch_times:
        return [dict(w) for w in words]

    def first_pitch_rise(lo: float, hi: float) -> Optional[float]:
        idx = bisect.bisect_left(pitch_times, lo)
        while idx < len(pitch_times) and pitch_times[idx] <= hi:
            if pitch_conf[idx] >= conf_threshold:
                return pitch_times[idx]
            idx += 1
        return None

    def first_rms_rise(lo: float, hi: float) -> Optional[float]:
        if not rms_times:
            return None
        # Local background = median RMS in [lo - 0.4, lo]
        bg_vals = []
        j = bisect.bisect_left(rms_times, max(0.0, lo - 0.4))
        while j < len(rms_times) and rms_times[j] < lo:
            bg_vals.append(rms_values[j])
            j += 1
        bg = sorted(bg_vals)[len(bg_vals) // 2] if bg_vals else 0.0
        # Threshold = background + a small absolute step (RMS scale ~0.01-0.5)
        thresh = max(bg + 0.025, bg * 1.6)
        j = bisect.bisect_left(rms_times, lo)
        while j < len(rms_times) and rms_times[j] <= hi:
            if rms_values[j] >= thresh:
                return rms_times[j]
            j += 1
        return None

    # Cache original starts/ends for the contiguous-vs-pause check at the end.
    orig = [(float(w["start"]), float(w["end"])) for w in words]
    refined: List[dict] = []

    for i, w in enumerate(words):
        ws, we = orig[i]
        # Bound the search so we don't overlap the previous refined word and
        # don't land past the next word's claimed start.
        prev_min = (refined[-1]["start"] + 0.05) if refined else 0.0
        next_max = float(words[i + 1]["start"]) - 0.05 if i + 1 < len(words) else float("inf")
        lo = max(ws - pre, prev_min)
        hi = min(ws + post, next_max)
        if hi < lo:
            hi = lo

        cand = [c for c in (first_pitch_rise(lo, hi), first_rms_rise(lo, hi)) if c is not None]
        new_start = min(cand) if cand else ws
        if new_start < prev_min:
            new_start = prev_min
        new_end = max(we, new_start + 0.12)

        refined.append({
            "word": w["word"],
            "start": round(new_start, 3),
            "end": round(new_end, 3),
        })

    # Second pass — preserve contiguity for mid-phrase words while keeping
    # original pauses intact.  Mid-phrase = Whisper had word.end == next.start.
    for i in range(len(refined) - 1):
        orig_end, orig_next_start = orig[i][1], orig[i + 1][0]
        was_contiguous = abs(orig_end - orig_next_start) < 0.02
        if was_contiguous:
            refined[i]["end"] = max(refined[i]["start"] + 0.12, refined[i + 1]["start"])

    n_shifted = sum(1 for i, r in enumerate(refined) if abs(r["start"] - orig[i][0]) > 0.05)
    avg_shift = (
        sum(r["start"] - orig[i][0] for i, r in enumerate(refined)) / len(refined)
        if refined
        else 0.0
    )
    logger.info(
        "Refined %d/%d word onsets (avg shift %+0.3fs)",
        n_shifted, len(refined), avg_shift,
    )
    return refined


def extract_pitch(audio_path: str, denoise: bool = False) -> Tuple[List[float], List[float], List[float]]:
    """
    Extract pitch contour using torchcrepe.
    Returns (times_sec, frequencies_hz, periodicities).
    Unvoiced/low-periodicity frames are returned as NaN in frequencies.
    """
    import torch
    import torchcrepe

    y, _ = librosa.load(audio_path, sr=SR, mono=True)

    # Bandpass filter: only apply to noisy user recordings, not clean reference tracks.
    # Removes broadband mic noise that confuses CREPE into classifying voiced frames
    # as unvoiced. Clean demucs-separated vocals don't need this and it hurts them.
    if denoise:
        from scipy.signal import butter, sosfilt
        sos = butter(4, [80.0, 1800.0], btype="bandpass", fs=SR, output="sos")
        y = sosfilt(sos, y).astype(np.float32)

    # Peak-normalize so CREPE works regardless of recording volume.
    peak = float(np.abs(y).max())
    if peak > 1e-6:
        y = y / peak * 0.98
    else:
        logger.warning("Audio from %s appears silent (peak=%.2e)", audio_path, peak)

    # torchcrepe expects a [1, T] float32 tensor
    audio = torch.from_numpy(y.astype(np.float32)).unsqueeze(0)

    model = os.environ.get("CREPE_MODEL", "tiny")  # 'tiny' or 'full'
    hop_length = 160  # 10 ms at 16 kHz

    device = "cuda" if torch.cuda.is_available() else "cpu"

    pitch, periodicity = torchcrepe.predict(
        audio,
        SR,
        hop_length=hop_length,
        fmin=50.0,
        fmax=2006.0,
        model=model,
        return_periodicity=True,
        device=device,
        decoder=torchcrepe.decode.viterbi,
        batch_size=512,
    )

    pitch_np = pitch.squeeze(0).cpu().numpy()           # [T]
    periodicity_np = periodicity.squeeze(0).cpu().numpy()  # [T]

    n_frames = pitch_np.shape[0]
    times = np.arange(n_frames) * hop_length / SR

    # torchcrepe periodicity threshold. Lower values = more frames kept as voiced.
    # 0.1 is a good default for singing (which is more periodic than speech but
    # still often has periodicity < 0.21 on consumer mics).
    threshold = float(os.environ.get("CREPE_THRESHOLD", "0.05"))
    voiced_mask = periodicity_np > threshold
    frequency_out = np.where(voiced_mask, pitch_np, np.nan)

    voiced_count = int(voiced_mask.sum())
    logger.info(
        "CREPE: %d total frames, %d voiced (%.0f%%) from %s",
        n_frames, voiced_count,
        100 * voiced_count / n_frames if n_frames else 0,
        audio_path,
    )

    return times.tolist(), frequency_out.tolist(), periodicity_np.tolist()


def extract_rms_envelope(
    audio_path: str,
) -> Tuple[List[float], List[float]]:
    """Extract RMS energy envelope. Returns (times_sec, rms_values)."""
    y, _ = librosa.load(audio_path, sr=SR, mono=True)
    rms = librosa.feature.rms(
        y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH
    )[0]
    times = librosa.times_like(rms, sr=SR, hop_length=HOP_LENGTH)
    return times.tolist(), rms.tolist()


def detect_vibrato(
    pitch_hz: List[float], times: List[float]
) -> float:
    """
    Detect vibrato as pitch oscillation in the 4–8 Hz range.
    Returns vibrato presence score 0–1.
    """
    valid = [
        (t, f)
        for t, f in zip(times, pitch_hz)
        if f is not None and not (isinstance(f, float) and np.isnan(f))
    ]
    if len(valid) < 30:
        return 0.0

    t_arr = np.array([v[0] for v in valid])
    f_arr = np.array([v[1] for v in valid])

    # Convert to cents (scale-invariant)
    cents = 1200.0 * np.log2(np.maximum(f_arr, 1e-6) / 440.0)

    dt = float(np.mean(np.diff(t_arr)))
    if dt <= 0:
        return 0.0

    freqs = np.fft.rfftfreq(len(cents), d=dt)
    magnitude = np.abs(np.fft.rfft(cents - cents.mean()))

    vibrato_band = (freqs >= 4.0) & (freqs <= 8.0)
    total_power = float(magnitude.sum())
    vibrato_power = float(magnitude[vibrato_band].sum())

    if total_power < 1e-9:
        return 0.0

    return min(1.0, vibrato_power / total_power * 3)


def get_median_pitch_in_window(
    times: List[float],
    freqs: List[float],
    start: float,
    end: float,
    min_frames: int = 3,
) -> Optional[float]:
    """Return median voiced pitch (Hz) within [start, end], or None."""
    valid = [
        f
        for t, f in zip(times, freqs)
        if start <= t <= end
        and f is not None
        and not (isinstance(f, float) and np.isnan(f))
        and f > 0
    ]
    if len(valid) < min_frames:
        return None
    return float(np.median(valid))


def hz_to_cents_diff(user_hz: float, ref_hz: float) -> float:
    """Signed cents difference: user relative to reference."""
    if user_hz <= 0 or ref_hz <= 0:
        return float("inf")
    return 1200.0 * np.log2(user_hz / ref_hz)


def estimate_pitch_offset(
    ref_times: List[float],
    ref_hz: List[float],
    user_times: List[float],
    user_hz: List[float],
    max_offset_sec: float = 8.0,
) -> float:
    """
    Estimate the global time offset between user and reference recordings
    by cross-correlating their pitch contours.
    Returns offset in seconds: add this to reference timestamps to get
    the corresponding position in the user recording.
    Positive = user is consistently late vs the reference.
    """
    from scipy.signal import correlate

    dt = 0.02  # 20 ms grid — fast enough, fine enough
    ref_max = float(max(ref_times)) if ref_times else 0.0
    user_max = float(max(user_times)) if user_times else 0.0
    max_time = min(ref_max, user_max, 120.0)

    if max_time < 4.0:
        return 0.0

    n = int(max_time / dt)
    t_grid = np.linspace(0, max_time, n)

    def voiced_semitones(times: List[float], freqs: List[float]) -> np.ndarray:
        t = np.array(times)
        f = np.array(freqs)
        voiced = ~np.isnan(f) & (f > 0)
        if voiced.sum() < 20:
            return np.zeros(n)
        semi = 69.0 + 12.0 * np.log2(np.maximum(f[voiced], 1.0) / 440.0)
        return np.interp(t_grid, t[voiced], semi, left=0.0, right=0.0)

    ref_s = voiced_semitones(ref_times, ref_hz)
    user_s = voiced_semitones(user_times, user_hz)

    if ref_s.std() < 0.5 or user_s.std() < 0.5:
        logger.info("Pitch contours too sparse for offset estimation — using 0")
        return 0.0

    ref_s -= ref_s.mean()
    user_s -= user_s.mean()

    max_lag = min(int(max_offset_sec / dt), n // 4)
    corr = correlate(user_s, ref_s, mode="full")
    mid = len(ref_s) - 1
    window = corr[mid - max_lag : mid + max_lag + 1]
    best_lag = int(np.argmax(window)) - max_lag
    offset = float(best_lag * dt)

    logger.info("Pitch contour cross-correlation offset: %.3f s", offset)
    return offset


def hz_to_note_name(hz: float) -> str:
    """Convert Hz to note name like 'F4' or 'D#5'."""
    if hz is None or hz <= 0 or np.isnan(hz):
        return "?"
    midi = librosa.hz_to_midi(float(hz))
    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    semitone = int(round(midi)) % 12
    octave = int(round(midi)) // 12 - 1
    return f"{note_names[semitone]}{octave}"

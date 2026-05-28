import os
import subprocess
import uuid
import logging
from pathlib import Path
from typing import Tuple, List, Optional

import numpy as np
import librosa
import soundfile as sf

logger = logging.getLogger(__name__)

TEMP_DIR = Path("./temp")
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
    """Download audio from YouTube URL and return path to normalized WAV."""
    import shutil
    import sys

    out_dir = TEMP_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    wav_out = str(out_dir / "original.wav")

    # Build yt-dlp command — no --postprocessor-args (we normalize with librosa)
    # Provide node.js path so yt-dlp can run JS extraction
    node_path = shutil.which("node") or "/opt/homebrew/bin/node"
    ytdlp_bin = shutil.which("yt-dlp") or str(
        Path(sys.executable).parent / "yt-dlp"
    )

    cmd = [
        ytdlp_bin,
        "-x",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--js-runtimes", "node",
        "-o", str(out_dir / "original.%(ext)s"),
        "--no-playlist",
        url,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise RuntimeError(
            f"yt-dlp failed:\n{result.stderr[-600:]}"
        )

    # Find downloaded file (yt-dlp names it original.<ext>)
    audio_exts = {".wav", ".mp3", ".m4a", ".webm", ".opus", ".ogg", ".aac"}
    candidates = [p for p in out_dir.iterdir() if p.suffix in audio_exts]
    if not candidates:
        raise RuntimeError(
            f"No audio file found in {out_dir} after yt-dlp.\n"
            f"yt-dlp stdout: {result.stdout[-300:]}"
        )

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

    # Normalize both to 16kHz mono
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

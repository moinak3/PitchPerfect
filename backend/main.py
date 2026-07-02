import json
import logging
import math
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="PitchPerfect API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # must be False when allow_origins="*"
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = Path(os.environ.get("PP_TEMP_DIR", "./temp"))
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# job_id → {status, progress, message, error?, reference?}
jobs: Dict[str, Dict[str, Any]] = {}

_executor = ThreadPoolExecutor(max_workers=2)


# ---------------------------------------------------------------------------
# Pipeline helpers (all synchronous — run in thread pool)
# ---------------------------------------------------------------------------

def _run_pipeline(
    job_id: str,
    audio_path: str,
    artist: str = "",
    song_title: str = "",
) -> None:
    """Full reference extraction pipeline (blocking). Called in thread pool."""
    from .audio_utils import separate_vocals, extract_pitch_pyin, extract_rms_envelope
    from .alignment import transcribe_with_timestamps
    from .lyrics_utils import lookup_lyrics, lyrics_to_prompt

    job = jobs[job_id]

    def update(status: str, progress: int, message: str) -> None:
        job.update({"status": status, "progress": progress, "message": message})
        logger.info("[%s] %s", job_id, message)
        # Persist progress to disk so get_job can recover after a container restart.
        try:
            status_file = TEMP_DIR / job_id / "status.json"
            status_file.parent.mkdir(parents=True, exist_ok=True)
            with open(status_file, "w") as _sf:
                json.dump({"status": status, "progress": progress, "message": message}, _sf)
        except Exception as _e:
            logger.warning("[%s] Failed to write status.json: %s", job_id, _e)

    try:
        # Look up lyrics early so we can use them as Whisper prompt
        lyrics = None
        if artist and song_title:
            update("looking_up_lyrics", 6, f"Looking up lyrics for '{artist} – {song_title}'...")
            lyrics = lookup_lyrics(artist, song_title)
            if lyrics:
                logger.info("[%s] Lyrics found (%d chars)", job_id, len(lyrics))
            else:
                logger.info("[%s] Lyrics not found, proceeding without prompt", job_id)

        update("separating_vocals", 10, "Separating vocals from backing track (demucs)...")

        def _sep_update(msg: str) -> None:
            job["message"] = msg

        vocals_path, backing_path = separate_vocals(audio_path, job_id, _sep_update)

        update("extracting_pitch", 55, "Extracting pitch with CREPE...")
        pitch_times, pitch_hz, pitch_conf = extract_pitch_pyin(vocals_path)

        update("extracting_dynamics", 70, "Analyzing dynamics and energy envelope...")
        rms_times, rms_values = extract_rms_envelope(vocals_path)

        update("transcribing", 80, "Aligning lyrics to the vocal...")
        from .alignment import detect_language
        language = detect_language(vocals_path)

        # PRIMARY PATH — CTC forced alignment of the KNOWN lyrics onto the
        # isolated vocal stem.  This is the gold standard for karaoke timing:
        # it produces frame-accurate (~20 ms) word onsets AND correct word
        # identity in one pass.  It far outperforms Whisper's cross-attention
        # `word_timestamps`, which drift systematically early on sustained
        # singing.  Only possible when we actually found lyrics for the song.
        words = None
        if lyrics:
            try:
                from .forced_align import forced_align_words, lyrics_to_word_list
                lyric_word_list = lyrics_to_word_list(lyrics)
                update("transcribing", 82, "Force-aligning lyrics to the vocal (word-level)...")
                fa_words = forced_align_words(vocals_path, lyric_word_list)
                if fa_words:
                    words = fa_words
                    logger.info("[%s] Forced alignment: %d words (frame-accurate onsets)", job_id, len(words))
                else:
                    logger.info("[%s] Forced alignment unusable — falling back to Whisper", job_id)
            except Exception:
                logger.exception("[%s] Forced alignment errored — falling back to Whisper", job_id)

        # FALLBACK PATH — Whisper transcription + acoustic-onset refinement.
        # Used when no lyrics were found (e.g. YouTube/upload without metadata)
        # or forced alignment failed.  We deliberately do NOT feed lyrics as
        # Whisper's initial_prompt: doing so biases Whisper into skipping the
        # soft opening verse (A/B verified: WITH prompt → first word 23.3s,
        # verse 1 dropped; WITHOUT → 7.6s, full coverage).  Whisper's early word
        # starts on sustained singing are then snapped to the acoustic onset
        # against the pitch-confidence and RMS curves.
        if words is None:
            update("transcribing", 84, "Transcribing lyrics with Whisper...")
            words = transcribe_with_timestamps(vocals_path, language=language, initial_prompt=None)
            from .audio_utils import refine_word_onsets
            words = refine_word_onsets(words, pitch_times, pitch_conf, rms_times, rms_values)

        if not words:
            logger.warning("[%s] No words transcribed — vocal track may be silent", job_id)

        duration = float(pitch_times[-1]) if pitch_times else 0.0

        # Vocal onset = start of the first substantial vocal section (skips
        # instrument bleed-through that demucs leaves at the confidence floor).
        from .audio_utils import detect_vocal_sections
        _, vocal_start_time = detect_vocal_sections(pitch_times, pitch_hz, pitch_conf)
        logger.info("[%s] Vocal start detected at %.1fs", job_id, vocal_start_time)

        reference = {
            "job_id": job_id,
            "duration": duration,
            "vocal_start_time": vocal_start_time,
            "language": language,
            "artist": artist,
            "song_title": song_title,
            "lyrics": lyrics,
            "words": words,
            "pitch_times": pitch_times,
            "pitch_hz": pitch_hz,
            "pitch_confidence": pitch_conf,
            "rms_times": rms_times,
            "rms_values": rms_values,
            "vocals_path": vocals_path,
            "backing_path": backing_path,
            "original_path": audio_path,
        }

        ref_file = TEMP_DIR / job_id / "reference.json"
        ref_file.parent.mkdir(parents=True, exist_ok=True)
        with open(ref_file, "w") as f:
            json.dump(reference, f)

        job.update(
            {
                "status": "complete",
                "progress": 100,
                "message": "Ready! Hit record and start singing.",
                "reference": reference,
            }
        )
        logger.info("[%s] Pipeline complete. Duration=%.1fs, Words=%d", job_id, duration, len(words))

    except Exception as exc:
        logger.exception("[%s] Pipeline failed", job_id)
        job.update(
            {
                "status": "error",
                "progress": 0,
                "error": str(exc),
                "message": f"Processing failed: {exc}",
            }
        )


def _download_and_run(job_id: str, url: str, artist: str = "", song_title: str = "") -> None:
    """Download YouTube audio then run pipeline. Blocking."""
    from .audio_utils import download_youtube
    from .lyrics_utils import extract_youtube_title, parse_artist_title

    try:
        jobs[job_id].update({"progress": 3, "message": "Downloading from YouTube..."})
        audio_path = download_youtube(url, job_id)
        jobs[job_id].update({"progress": 8, "message": "Download complete. Starting analysis..."})

        # Auto-detect artist/title from YouTube if not provided
        if not artist and not song_title:
            raw = extract_youtube_title(url) or ""
            if raw:
                artist, song_title = parse_artist_title(raw)
                logger.info("[%s] Auto-detected: artist='%s' title='%s'", job_id, artist, song_title)

        _run_pipeline(job_id, audio_path, artist=artist, song_title=song_title)
    except Exception as exc:
        logger.exception("[%s] YouTube download failed", job_id)
        jobs[job_id].update(
            {
                "status": "error",
                "error": str(exc),
                "message": f"Download failed: {exc}",
            }
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "service": "PitchPerfect"}


@app.get("/api/job/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        # Attempt to recover from disk (handles Modal container restarts).
        ref_file = TEMP_DIR / job_id / "reference.json"
        status_file = TEMP_DIR / job_id / "status.json"
        if ref_file.exists():
            with open(ref_file) as f:
                reference = json.load(f)
            disk_status = {}
            if status_file.exists():
                with open(status_file) as f:
                    disk_status = json.load(f)
            jobs[job_id] = {
                "status": disk_status.get("status", "complete"),
                "progress": disk_status.get("progress", 100),
                "message": disk_status.get("message", "Ready!"),
                "reference": reference,
            }
            logger.info("[%s] Reconstructed job state from disk", job_id)
        elif status_file.exists():
            # Still processing — recover progress display but no reference yet
            with open(status_file) as f:
                disk_status = json.load(f)
            jobs[job_id] = disk_status
            logger.info("[%s] Recovered in-progress status from disk", job_id)
        else:
            raise HTTPException(404, "Job not found")
    job = jobs[job_id]

    pitch_guide = None
    vocal_start_time = job["reference"].get("vocal_start_time", 0.0) if "reference" in job else 0.0
    if "reference" in job:
        from .audio_utils import detect_vocal_sections

        raw_times = job["reference"].get("pitch_times", [])
        raw_hz = job["reference"].get("pitch_hz", [])
        raw_conf = job["reference"].get("pitch_confidence", [])
        words = job["reference"].get("words", [])

        # Determine the time ranges that actually contain singing, so the pitch
        # contour stays dense there while instrument bleed (piano intro, breaks)
        # is excluded.  Whisper word spans are the most reliable vocal mask — a
        # word exists exactly where something is sung — and crucially they KEEP
        # soft / low-confidence singing (e.g. "I can't help") that a pitch-
        # confidence gate would wrongly drop.  Fall back to confidence-based
        # vocal sections only when there are no transcribed words.
        PAD = 0.2
        if words:
            ranges = [(float(w["start"]) - PAD, float(w["end"]) + PAD) for w in words]
            # merge overlapping/adjacent windows (words are time-ordered)
            merged = []
            for a, b in ranges:
                if merged and a <= merged[-1][1]:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            ranges = merged
            vocal_start_time = float(words[0]["start"])
        else:
            sections, vstart = detect_vocal_sections(raw_times, raw_hz, raw_conf)
            ranges = [[a - PAD, b + PAD] for (a, b) in sections]
            vocal_start_time = vstart

        # Keep every voiced (non-NaN) frame whose time falls inside a vocal range.
        gt, ghz = [], []
        ri = 0
        n_ranges = len(ranges)
        for i in range(len(raw_times)):
            h = raw_hz[i]
            if h is None or (isinstance(h, float) and math.isnan(h)) or h <= 0:
                continue
            t = raw_times[i]
            while ri < n_ranges and t > ranges[ri][1]:
                ri += 1
            if ri < n_ranges and t >= ranges[ri][0]:
                gt.append(round(t, 3))
                ghz.append(round(h, 1))

        # Light downsample only if very large (keeps payload reasonable)
        MAX_FRAMES = 8000
        if len(gt) > MAX_FRAMES:
            step = max(1, len(gt) // MAX_FRAMES)
            gt = gt[::step]
            ghz = ghz[::step]
        pitch_guide = {"times": gt, "hz": ghz}

    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "message": job.get("message", ""),
        "error": job.get("error"),
        "has_reference": "reference" in job,
        "word_count": len(job["reference"]["words"]) if "reference" in job else 0,
        "vocal_start_time": vocal_start_time,
        "song_duration": job["reference"].get("duration", 0.0) if "reference" in job else 0.0,
        "words": job["reference"].get("words", []) if "reference" in job else [],
        "lyrics": job["reference"].get("lyrics") if "reference" in job else None,
        "song_title": job["reference"].get("song_title", "") if "reference" in job else "",
        "artist": job["reference"].get("artist", "") if "reference" in job else "",
        "pitch_guide": pitch_guide,
    }


@app.post("/api/process-youtube")
async def process_youtube(
    url: str = Form(...),
    artist: str = Form(default=""),
    song_title: str = Form(default=""),
):
    job_id = str(uuid.uuid4())[:8]
    (TEMP_DIR / job_id).mkdir(parents=True, exist_ok=True)

    jobs[job_id] = {
        "status": "downloading",
        "progress": 1,
        "message": "Queuing download...",
    }

    _executor.submit(_download_and_run, job_id, url, artist, song_title)
    return {"job_id": job_id}


@app.post("/api/upload-song")
async def upload_song(
    file: UploadFile = File(...),
    artist: str = Form(default=""),
    song_title: str = Form(default=""),
):
    suffix = Path(file.filename or "audio.wav").suffix.lower()
    if suffix not in {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"}:
        raise HTTPException(400, f"Unsupported format: {suffix}")

    job_id = str(uuid.uuid4())[:8]
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    raw_path = job_dir / f"upload{suffix}"
    content = await file.read()
    raw_path.write_bytes(content)

    # Normalize to 16kHz mono WAV upfront
    wav_path = job_dir / "original.wav"
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw_path), "-ar", "16000", "-ac", "1", str(wav_path)],
        capture_output=True,
    )
    if result.returncode != 0:
        raise HTTPException(500, f"ffmpeg conversion failed: {result.stderr.decode()[:200]}")

    jobs[job_id] = {
        "status": "processing",
        "progress": 5,
        "message": "Upload complete. Starting vocal separation...",
    }

    _executor.submit(_run_pipeline, job_id, str(wav_path), artist, song_title)
    return {"job_id": job_id}


def _recover_job_from_disk(job_id: str) -> bool:
    """Load a completed job from the persistent Volume if not in memory. Returns True if found."""
    ref_file = TEMP_DIR / job_id / "reference.json"
    if ref_file.exists():
        with open(ref_file) as f:
            reference = json.load(f)
        jobs[job_id] = {
            "status": "complete",
            "progress": 100,
            "message": "Ready!",
            "reference": reference,
        }
        logger.info("[%s] Reconstructed job from disk", job_id)
        return True
    return False


@app.post("/api/analyze")
async def analyze(
    job_id: str = Form(...),
    user_audio: UploadFile = File(...),
):
    if job_id not in jobs and not _recover_job_from_disk(job_id):
        raise HTTPException(404, "Job not found")

    job = jobs[job_id]
    if "reference" not in job:
        raise HTTPException(400, "Reference performance not ready — is the song still processing?")

    # Save user audio
    user_dir = TEMP_DIR / job_id / "user"
    user_dir.mkdir(parents=True, exist_ok=True)

    raw_suffix = Path(user_audio.filename or "rec.webm").suffix or ".webm"
    raw_path = user_dir / f"recording{raw_suffix}"
    raw_path.write_bytes(await user_audio.read())

    # Convert to 16kHz mono WAV
    wav_path = user_dir / "recording.wav"
    res = subprocess.run(
        ["ffmpeg", "-y", "-i", str(raw_path), "-ar", "16000", "-ac", "1", str(wav_path)],
        capture_output=True,
    )
    if res.returncode != 0:
        raise HTTPException(500, f"ffmpeg conversion failed: {res.stderr.decode()[:200]}")

    # Check recording length and loudness
    import librosa
    import numpy as _np
    duration = librosa.get_duration(path=str(wav_path))
    if duration < 2.0:
        raise HTTPException(400, "Recording is too short (< 2 seconds). Please sing more.")

    _y, _ = librosa.load(str(wav_path), sr=16000, mono=True)
    rms = float(_np.sqrt(_np.mean(_y ** 2)))
    logger.info("[%s] User recording RMS=%.4f duration=%.1fs", job_id, rms, duration)
    if rms < 0.002:
        raise HTTPException(
            400,
            f"Recording appears to be silent (RMS={rms:.4f}). "
            "Your microphone may not be working or the wrong input device is selected. "
            "Check your browser's microphone permissions and try again."
        )

    import asyncio
    loop = asyncio.get_event_loop()
    from .scoring import analyze_performance

    try:
        result = await loop.run_in_executor(
            _executor, analyze_performance, job["reference"], str(wav_path)
        )
    except Exception as exc:
        logger.exception("[%s] Analysis failed", job_id)
        raise HTTPException(500, f"Analysis failed: {exc}")

    job["user_recording_path"] = str(wav_path)
    return result


@app.post("/api/job/{job_id}/retranscribe")
async def retranscribe(job_id: str, lyrics: str = Form(...)):
    """Update the reference lyrics (used as the karaoke TEXT) and refresh Whisper
    word timing.  Like the main pipeline, transcription runs WITHOUT a lyrics
    prompt so Whisper keeps complete, accurately-timed word coverage; the edited
    lyrics are stored as the source text and aligned onto those timestamps."""
    if job_id not in jobs and not _recover_job_from_disk(job_id):
        raise HTTPException(404, "Job not found")
    job = jobs[job_id]
    if "reference" not in job:
        raise HTTPException(400, "Reference not ready")

    ref = job["reference"]
    vocals_path = ref.get("vocals_path")
    if not vocals_path or not Path(vocals_path).exists():
        raise HTTPException(404, "Vocals file not found on disk")

    language = ref.get("language")

    import asyncio
    loop = asyncio.get_event_loop()

    def _realign() -> list:
        # PRIMARY: force-align the edited lyrics onto the vocal stem for
        # frame-accurate onsets on exactly the words the user typed.
        try:
            from .forced_align import forced_align_words, lyrics_to_word_list
            fa_words = forced_align_words(vocals_path, lyrics_to_word_list(lyrics))
            if fa_words:
                logger.info("[%s] Retranscribe via forced alignment → %d words", job_id, len(fa_words))
                return fa_words
        except Exception:
            logger.exception("[%s] Forced alignment failed on retranscribe — using Whisper", job_id)

        # FALLBACK: Whisper + acoustic-onset refinement.
        from .alignment import transcribe_with_timestamps
        from .audio_utils import refine_word_onsets
        w = transcribe_with_timestamps(vocals_path, language=language, initial_prompt=None)
        return refine_word_onsets(
            w,
            ref.get("pitch_times", []),
            ref.get("pitch_confidence", []),
            ref.get("rms_times", []),
            ref.get("rms_values", []),
        )

    try:
        words = await loop.run_in_executor(_executor, _realign)
    except Exception as exc:
        logger.exception("[%s] Retranscription failed", job_id)
        raise HTTPException(500, f"Retranscription failed: {exc}")

    ref["words"] = words
    ref["lyrics"] = lyrics
    logger.info("[%s] Retranscribed with edited lyrics → %d words", job_id, len(words))
    return {"words": words, "lyrics": lyrics}


@app.get("/api/audio/{job_id}/{track}")
def serve_audio(job_id: str, track: str):
    if job_id not in jobs:
        _recover_job_from_disk(job_id)
    if job_id not in jobs or "reference" not in jobs[job_id]:
        raise HTTPException(404, "Reference not found")

    ref = jobs[job_id]["reference"]
    path_map = {
        "original": ref.get("original_path"),
        "vocals": ref.get("vocals_path"),
        "backing": ref.get("backing_path"),
    }

    if track not in path_map:
        raise HTTPException(400, f"Unknown track '{track}'. Use: original, vocals, backing")

    audio_path = path_map[track]
    if not audio_path or not Path(audio_path).exists():
        raise HTTPException(404, f"Audio file for track '{track}' not found on disk")

    ext = Path(audio_path).suffix.lower()
    mime = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg"}.get(ext, "audio/wav")

    return FileResponse(
        path=audio_path,
        media_type=mime,
        headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600"},
    )


@app.get("/api/recording/{job_id}")
def serve_user_recording(job_id: str):
    if job_id not in jobs:
        _recover_job_from_disk(job_id)
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    path = jobs[job_id].get("user_recording_path")
    if not path or not Path(path).exists():
        raise HTTPException(404, "User recording not found — submit an analysis first")
    return FileResponse(
        path=path,
        media_type="audio/wav",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Sample song — pre-processed once, shared by all users.
# ---------------------------------------------------------------------------
# The sample MP3 lives on the Modal Volume at /pitchperfect-data/sample-song.mp3
# (upload once with: modal volume put pitchperfect-data <local.mp3> /sample-song.mp3)
# After the first call that triggers processing, all subsequent callers get the
# cached job instantly — no waiting for demucs.

SAMPLE_JOB_ID = "sample-v1"
SAMPLE_MP3_PATH = Path(os.environ.get("PP_TEMP_DIR", "./temp")).parent / "sample-song.mp3"
_sample_processing = False   # simple guard against double-start


@app.post("/api/sample-song")
def get_or_start_sample():
    global _sample_processing

    # Already cached and complete?
    if _recover_job_from_disk(SAMPLE_JOB_ID):
        return {"job_id": SAMPLE_JOB_ID, "cached": True}

    # Already in memory (processing or complete)?
    if SAMPLE_JOB_ID in jobs:
        return {"job_id": SAMPLE_JOB_ID, "cached": False}

    # Source file missing from Volume — instruct the operator.
    if not SAMPLE_MP3_PATH.exists():
        raise HTTPException(
            503,
            "Sample song not yet uploaded to the Modal Volume. "
            "Run: modal volume put pitchperfect-data cant-help-falling-in-love.mp3 /sample-song.mp3"
        )

    if not _sample_processing:
        _sample_processing = True
        jobs[SAMPLE_JOB_ID] = {
            "status": "processing",
            "progress": 2,
            "message": "Starting sample song processing…",
        }
        _executor.submit(
            _run_pipeline,
            SAMPLE_JOB_ID,
            str(SAMPLE_MP3_PATH),
            "Elvis Presley",
            "Can't Help Falling in Love",
        )

    return {"job_id": SAMPLE_JOB_ID, "cached": False}


# ---------------------------------------------------------------------------
# Serve built frontend (production / ngrok demo mode)
# Mount after all API routes so /api/* is never shadowed.
# ---------------------------------------------------------------------------
_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if _FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        return FileResponse(str(_FRONTEND_DIST / "index.html"))

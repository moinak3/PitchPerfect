"""
modal_app.py — Deploy PitchPerfect backend to Modal.

Setup (one-time):
    pip install modal
    modal setup          # authenticate with your Modal account

Deploy (production — gets a permanent HTTPS URL):
    modal deploy modal_app.py

Dev mode (temporary URL, auto-reload on code change):
    modal serve modal_app.py

After deploying, copy the printed URL into frontend/vercel.json under
the "destination" field of the /api rewrite rule, e.g.:
    "destination": "https://your-workspace--pitchperfect-fastapi-app.modal.run/api/:path*"
"""

import modal
from pathlib import Path

# ---------------------------------------------------------------------------
# App + infrastructure
# ---------------------------------------------------------------------------

app = modal.App("pitchperfect")

# Persistent volume: audio files and processed data survive container restarts.
volume = modal.Volume.from_name("pitchperfect-data", create_if_missing=True)
DATA_DIR = "/pitchperfect-data"

# ---------------------------------------------------------------------------
# Container image
# ---------------------------------------------------------------------------
# Python 3.11 is the sweet spot for all ML deps (torch, demucs, whisper).
# The backend source is baked into the image — re-run `modal deploy` after
# any backend code change.

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg",       # audio conversion throughout the pipeline
        "libsndfile1",  # required by soundfile / librosa
        "git",          # some pip packages need git at install time
        "nodejs",       # yt-dlp JS runtime for n-sig challenge solving
    )
    .pip_install(
        # Web framework
        "fastapi>=0.104.0",
        "uvicorn>=0.24.0",
        "python-multipart>=0.0.6",
        # Audio
        "librosa>=0.10.0",
        "soundfile>=0.12.1",
        "pydub>=0.25.1",
        # ML — install torch first so demucs/whisper share it
        "torch>=2.0.0",
        "torchaudio<2.6",
        "numpy>=1.24.0",
        "scipy>=1.11.0",
        # Vocal separation (downloads htdemucs model on first run, then cached)
        "demucs>=4.0.0",
        # Transcription (downloads whisper model on first run, then cached)
        "openai-whisper>=20231117",
        # YouTube download — pytubefix handles nsig in pure Python (no JS needed),
        # yt-dlp kept as fallback for title extraction
        "pytubefix",
        "yt-dlp",
    )
    # Bake backend source into the image.
    # Re-run `modal deploy modal_app.py` after any backend code change.
    .add_local_dir("./backend", remote_path="/root/backend")
)

# ---------------------------------------------------------------------------
# ASGI endpoint
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    # A10G GPU: demucs runs in 2-5 min instead of 15+ on CPU.
    # To cut cost at the expense of speed, remove the gpu= line.
    gpu="A10G",
    volumes={DATA_DIR: volume},
    # 10-minute timeout covers long songs + Whisper transcription.
    timeout=600,
    # Scale to zero after 5 minutes idle — no idle GPU cost.
    # First cold start: ~90s (pip cache warm after first deploy).
    scaledown_window=300,
)
# Up to 5 concurrent API requests per container (FastAPI is async).
# For 5-10 beta users this handles burst without spawning a second GPU.
@modal.concurrent(max_inputs=5)
@modal.asgi_app()
def fastapi_app():
    """Called once per container start to return the ASGI app."""
    import os
    import sys

    # Project root on path so `from backend.x import y` works.
    sys.path.insert(0, "/root")

    # All temp files go to the persistent volume.
    os.environ["PP_TEMP_DIR"] = f"{DATA_DIR}/temp"

    from backend.main import app as _app
    return _app

# PitchPerfect — AI Vocal Coach

Analyzes how well you sing along to any song. Gives word-by-word pitch accuracy, timing, and dynamics feedback.

## How It Works

1. **Paste a YouTube URL** (or upload an MP3/WAV)
2. **Backend processes the song** — downloads audio, runs `demucs` to separate vocals from backing track, extracts pitch with `CREPE`, transcribes lyrics with `Whisper`
3. **Record yourself singing** — browser captures your mic via Web Audio API while playing the song
4. **Analysis** — backend compares your pitch, timing, and dynamics against the reference performance, word by word
5. **Results** — animated score reveal, color-coded lyric breakdown, specific coaching notes with timestamps

## Prerequisites

- Python 3.9+
- Node.js 18+
- `ffmpeg` installed and on PATH (required by yt-dlp and pydub)
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`

## Setup

### 1. Python backend

```bash
cd /path/to/PitchPerfect

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate      # macOS/Linux
# .venv\Scripts\activate       # Windows

# Install dependencies (torch first for CUDA detection)
pip install torch torchvision torchaudio  # or follow pytorch.org for GPU builds
pip install -r requirements.txt
```

> **Note on CREPE:** The `crepe` package uses TensorFlow by default. Install TensorFlow if you see import errors:
> `pip install tensorflow` (or `tensorflow-cpu` for CPU-only).

> **Note on demucs:** Runs on CPU or CUDA GPU. GPU is 5–10× faster. First run downloads the htdemucs model weights (~80 MB).

### 2. Frontend

```bash
cd frontend
npm install
```

### 3. Environment (optional)

Copy `.env.example` to `.env` and adjust Whisper/CREPE model sizes:

```bash
cp .env.example .env
```

## Running

Open **two terminals**:

**Terminal 1 — Backend:**
```bash
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. Paste a YouTube URL (e.g. a song you want to sing) and click **Analyze Song**
2. Wait for processing (2–5 minutes for demucs separation — a progress bar shows each stage)
3. In the Recording Studio, choose **Backing Only** or **With Vocals** playback
4. Click **REC** — a 3-second countdown starts, then the song plays and your mic records
5. Click **Stop Recording** when done
6. Click **Analyze My Performance** — results appear in ~30 seconds

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/process-youtube` | Start YouTube processing (form field: `url`) |
| `POST` | `/api/upload-song` | Upload audio file |
| `GET`  | `/api/job/{id}` | Poll processing status |
| `GET`  | `/api/audio/{id}/{track}` | Serve audio (`original`, `vocals`, `backing`) |
| `POST` | `/api/analyze` | Submit user recording for analysis |

## Scoring

| Dimension | Weight | Method |
|-----------|--------|--------|
| Pitch | 45% | CREPE pitch vs reference, ±50¢ = on pitch |
| Timing | 35% | Whisper word timestamps, ±200ms = on time |
| Dynamics | 20% | RMS envelope correlation + vibrato matching |

## File Structure

```
PitchPerfect/
├── backend/
│   ├── main.py          # FastAPI app, job management
│   ├── audio_utils.py   # demucs, CREPE, librosa utilities
│   ├── alignment.py     # Whisper transcription + word alignment
│   ├── scoring.py       # Pitch/timing/dynamics scoring, coaching
│   └── models.py        # Pydantic schemas
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/
│   │       ├── SongInput.jsx
│   │       ├── RecordingStudio.jsx
│   │       ├── AnalysisResults.jsx
│   │       ├── PitchTimeline.jsx
│   │       └── CoachingReport.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── requirements.txt
└── README.md
```

## Troubleshooting

**`demucs` not found:** Make sure you ran `pip install demucs` inside your venv.

**ffmpeg errors:** Ensure `ffmpeg` is on PATH: `which ffmpeg` should return a path.

**Microphone not recording:** Browser requires HTTPS or localhost for mic access. Use `http://localhost:5173`.

**CREPE taking too long:** Set `CREPE_MODEL=tiny` in `.env` for faster (less accurate) processing.

**Whisper model download:** First run downloads the Whisper model weights from the internet (~140 MB for `base`).

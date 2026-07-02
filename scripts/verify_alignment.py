"""
verify_alignment.py — Objective accuracy check for forced-alignment onsets.

Runs on Modal with the persistent Volume mounted.  It force-aligns the sample
song's lyrics onto its isolated vocal stem, then measures how well each word's
onset lines up with the actual vocal-energy rise in the audio.

Run:  .venv/bin/modal run scripts/verify_alignment.py
"""
import modal
from pathlib import Path

volume = modal.Volume.from_name("pitchperfect-data", create_if_missing=True)
DATA_DIR = "/pitchperfect-data"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "librosa>=0.10.0", "soundfile>=0.12.1", "numpy>=1.24.0", "scipy>=1.11.0",
        "torch>=2.0.0", "torchaudio<2.6",
    )
    .add_local_dir("./backend", remote_path="/root/backend")
)

app = modal.App("pp-verify-alignment", image=image)


@app.function(gpu="A10G", volumes={DATA_DIR: volume}, timeout=600)
def verify(job_id: str = "sample-v1"):
    import os, json, sys
    import numpy as np
    import librosa
    sys.path.insert(0, "/root")
    os.environ["PP_TEMP_DIR"] = f"{DATA_DIR}/temp"

    from backend.forced_align import forced_align_words, lyrics_to_word_list

    ref_path = Path(f"{DATA_DIR}/temp/{job_id}/reference.json")
    ref = json.loads(ref_path.read_text())
    vocals_path = ref["vocals_path"]
    lyrics = ref.get("lyrics") or ""

    report = {"job_id": job_id, "vocals_path": vocals_path, "have_lyrics": bool(lyrics)}

    fa_words = forced_align_words(vocals_path, lyrics_to_word_list(lyrics))
    report["fa_word_count"] = len(fa_words)
    report["first_20_fa"] = [
        f'{w["word"]} [{w["start"]:.2f}-{w["end"]:.2f}] s={w.get("score",0):.2f}'
        for w in fa_words[:20]
    ]

    # ── Objective onset accuracy vs. vocal energy ──────────────────────────
    # Compute a spectral-flux onset envelope on the vocal stem, pick onset peaks,
    # and measure |word.start - nearest detected vocal onset| for each word.
    y, sr = librosa.load(vocals_path, sr=16000, mono=True)
    hop = 160  # 10 ms
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=True,
        units="frames",
    )
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
    onset_times = np.asarray(onset_times, dtype=float)

    def nearest(t):
        if len(onset_times) == 0:
            return None
        i = int(np.argmin(np.abs(onset_times - t)))
        return float(onset_times[i] - t)  # signed: +ve => detected onset is AFTER word.start

    if fa_words and len(onset_times):
        deltas = [nearest(w["start"]) for w in fa_words]
        abs_d = np.abs(deltas)
        report["onset_match"] = {
            "n_detected_onsets": int(len(onset_times)),
            "median_abs_err_ms": round(float(np.median(abs_d)) * 1000, 1),
            "mean_abs_err_ms": round(float(np.mean(abs_d)) * 1000, 1),
            "p90_abs_err_ms": round(float(np.percentile(abs_d, 90)) * 1000, 1),
            "within_100ms_pct": round(float(np.mean(abs_d <= 0.10)) * 100, 1),
            "within_200ms_pct": round(float(np.mean(abs_d <= 0.20)) * 100, 1),
            "mean_signed_ms": round(float(np.mean(deltas)) * 1000, 1),
        }
        report["fa_mean_score"] = round(float(np.mean([w.get("score", 0) for w in fa_words])), 3)

    return report


@app.local_entrypoint()
def main(job_id: str = "sample-v1"):
    import json
    print("VERIFY_RESULT:\n" + json.dumps(verify.remote(job_id), indent=2))

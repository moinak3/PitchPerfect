"""
forced_align.py — Word-level forced alignment via wav2vec2 CTC.

The karaoke scroll needs the EXACT moment each word is sung.  Whisper's
`word_timestamps` are derived from decoder cross-attention (DTW) and drift
early on sustained singing.  Forced alignment instead takes the ISOLATED vocal
stem (from demucs) plus the KNOWN lyrics (from the lyrics lookup) and finds,
frame by frame (~20 ms), where each word actually lands in the audio.  This is
the gold-standard approach for lyric/karaoke alignment.

We use torchaudio's built-in MMS_FA pipeline (a multilingual wav2vec2 CTC
model) — it ships with torchaudio, so there is no extra pip dependency; only a
one-time model-weights download at runtime.

Public API:
    forced_align_words(vocals_path, lyric_words) -> List[{word, start, end, score}]
    lyrics_to_word_list(lyrics_text)             -> List[str]
"""

import logging
import re
import unicodedata
from typing import Dict, List, Optional, Union

logger = logging.getLogger(__name__)

# Lazy singletons — the model is ~1 GB and loads once per container.
_fa_bundle = None
_fa_model = None
_fa_dict: Optional[Dict[str, int]] = None


def _get_fa():
    """Load (once) the MMS_FA model, dictionary, and bundle. Returns them."""
    global _fa_bundle, _fa_model, _fa_dict
    if _fa_model is None:
        import torch
        import torchaudio

        _fa_bundle = torchaudio.pipelines.MMS_FA
        device = "cuda" if torch.cuda.is_available() else "cpu"

        # with_star=False → no <star> label; we rely on the CTC blank to absorb
        # instrumental intros/outros and un-sung frames.
        try:
            _fa_model = _fa_bundle.get_model(with_star=False)
        except TypeError:
            _fa_model = _fa_bundle.get_model()
        _fa_model = _fa_model.to(device).eval()

        try:
            _fa_dict = _fa_bundle.get_dict(star=None)
        except TypeError:
            _fa_dict = _fa_bundle.get_dict()

        logger.info(
            "MMS_FA forced-alignment model loaded (%d tokens, sr=%d) on %s",
            len(_fa_dict), _fa_bundle.sample_rate, device,
        )
    return _fa_bundle, _fa_model, _fa_dict


def lyrics_to_word_list(lyrics: str) -> List[str]:
    """
    Split raw lyrics text into an ordered list of display words.

    Strips section markers like "[Verse 1]" / "[Chorus]" (LyricsOVH occasionally
    includes them) but KEEPS parenthetical content, which is often sung backing
    vocals.  Punctuation stays attached to the display token; normalisation for
    the aligner happens separately.
    """
    text = re.sub(r"\[.*?\]", " ", lyrics or "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return [tok for tok in re.split(r"\s+", text) if tok.strip()]


def _normalize_for_alignment(word: str, dictionary: Dict[str, int]) -> str:
    """
    Reduce a display word to the character alphabet the aligner understands
    (lowercase Latin letters + apostrophe for MMS_FA).  Accents are stripped via
    NFKD; curly apostrophes are folded to straight.  Any char not in the model
    dictionary (or the blank '-') is dropped.  Returns "" if nothing survives
    (e.g. a purely non-Latin or numeric token) — the caller then skips it.
    """
    w = word.lower().replace("\u2019", "'").replace("\u02bc", "'")
    w = unicodedata.normalize("NFKD", w)
    w = "".join(c for c in w if not unicodedata.combining(c))
    out = []
    for c in w:
        if c == "-":            # '-' is the CTC blank in the dictionary — never emit it
            continue
        if c in dictionary:
            out.append(c)
    return "".join(out)


def forced_align_words(
    vocals_path: str,
    lyric_words: List[Union[str, dict]],
    min_mean_score: float = 0.15,
) -> List[Dict]:
    """
    Align an ordered list of lyric words onto the vocal audio.

    Args:
        vocals_path: isolated vocal stem (any sample rate; resampled to 16 kHz).
        lyric_words: ordered display words (strings) or dicts with a "word" key.
        min_mean_score: if the mean per-word alignment probability falls below
                        this, the lyrics probably don't match the audio and we
                        return [] so the caller can fall back to Whisper.

    Returns:
        List of {word, start, end, score} in lyric order (words that tokenise to
        nothing are skipped).  Empty list ⇒ alignment not usable.
    """
    import torch
    import torchaudio
    import torchaudio.functional as F

    bundle, model, dictionary = _get_fa()
    device = next(model.parameters()).device
    target_sr = bundle.sample_rate  # 16000

    # ── Load + prep audio ──────────────────────────────────────────────────
    waveform, sr = torchaudio.load(vocals_path)
    if waveform.size(0) > 1:                       # → mono
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != target_sr:
        waveform = F.resample(waveform, sr, target_sr)

    # ── Build token list, remembering which display word each span belongs to ─
    display_words: List[str] = []
    norm_words: List[str] = []
    for item in lyric_words:
        original = item if isinstance(item, str) else item.get("word", "")
        norm = _normalize_for_alignment(original, dictionary)
        if norm:
            display_words.append(original)
            norm_words.append(norm)

    if not norm_words:
        logger.warning("Forced alignment: no tokenisable words in lyrics — skipping")
        return []

    tokens = [dictionary[c] for word in norm_words for c in word]
    targets = torch.tensor([tokens], dtype=torch.int32, device=device)

    # ── Emission (frame-level log-probs) + Viterbi forced alignment ─────────
    try:
        with torch.inference_mode():
            emission, _ = model(waveform.to(device))
            aligned, scores = F.forced_align(emission, targets, blank=0)
    except torch.cuda.OutOfMemoryError:
        logger.warning("Forced alignment OOM on GPU — retrying on CPU")
        torch.cuda.empty_cache()
        model_cpu = model.to("cpu")
        with torch.inference_mode():
            emission, _ = model_cpu(waveform.to("cpu"))
            aligned, scores = F.forced_align(emission, targets.to("cpu"), blank=0)
        model.to(device)  # restore for next call

    aligned, scores = aligned[0], scores[0].exp()   # exp → probability in [0,1]
    token_spans = F.merge_tokens(aligned, scores)

    if len(token_spans) != len(tokens):
        # Should not happen (one span per target token) — bail defensively.
        logger.warning(
            "Forced alignment span/token mismatch (%d spans vs %d tokens) — skipping",
            len(token_spans), len(tokens),
        )
        return []

    # seconds per emission frame
    num_frames = emission.size(1)
    sec_per_frame = (waveform.size(1) / num_frames) / target_sr

    # ── Group token spans back into words ──────────────────────────────────
    words_out: List[Dict] = []
    span_i = 0
    score_sum = 0.0
    for disp, norm in zip(display_words, norm_words):
        n = len(norm)
        spans = token_spans[span_i : span_i + n]
        span_i += n
        if not spans:
            continue
        start = spans[0].start * sec_per_frame
        end = spans[-1].end * sec_per_frame
        # duration-weighted mean probability across the word's tokens
        dur = sum(max(1, s.end - s.start) for s in spans)
        wscore = sum(s.score * max(1, s.end - s.start) for s in spans) / dur
        score_sum += wscore
        words_out.append({
            "word": disp,
            "start": round(float(start), 3),
            "end": round(float(end), 3),
            "score": round(float(wscore), 3),
        })

    if not words_out:
        return []

    mean_score = score_sum / len(words_out)
    logger.info(
        "Forced alignment: %d words, mean score %.3f, span %.2f–%.2fs",
        len(words_out), mean_score, words_out[0]["start"], words_out[-1]["end"],
    )

    if mean_score < min_mean_score:
        logger.warning(
            "Forced alignment mean score %.3f < %.2f — lyrics likely mismatch audio; skipping",
            mean_score, min_mean_score,
        )
        return []

    # Guarantee monotonic, non-overlapping starts (Viterbi already monotonic,
    # but rounding can tie adjacent words).
    for i in range(1, len(words_out)):
        if words_out[i]["start"] < words_out[i - 1]["start"]:
            words_out[i]["start"] = words_out[i - 1]["start"]
        if words_out[i]["end"] < words_out[i]["start"]:
            words_out[i]["end"] = words_out[i]["start"] + 0.05

    return words_out

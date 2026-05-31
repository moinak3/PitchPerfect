import json
import logging
import re
import subprocess
import urllib.parse
import urllib.request
import urllib.error
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def _fetch_lyrics_ovh(artist: str, title: str) -> Optional[str]:
    """Single LyricsOVH request. Returns lyrics text or None (incl. 404)."""
    url = (
        "https://api.lyrics.ovh/v1/"
        + urllib.parse.quote(artist.strip())
        + "/"
        + urllib.parse.quote(title.strip())
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PitchPerfect/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            lyrics = (data.get("lyrics") or "").strip()
            return lyrics or None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None  # song not found under this exact spelling — try a variant
        logger.warning("Lyrics lookup HTTP error for '%s – %s': %s", artist, title, e)
        return None
    except Exception as e:
        logger.warning("Lyrics lookup failed for '%s – %s': %s", artist, title, e)
        return None


def _title_variants(title: str):
    """Yield distinct title spellings to try (LyricsOVH is picky about
    punctuation — e.g. it has 'Cant Help...' but 404s on 'Can't Help...')."""
    seen = set()
    candidates = [
        title,
        title.replace("'", "").replace("’", ""),   # drop apostrophes
        re.sub(r"[^\w\s]", "", title),              # drop all punctuation
        re.sub(r"\s*\(.*?\)\s*", "", title).strip(),  # drop "(...)" suffixes
    ]
    for c in candidates:
        c = c.strip()
        key = c.lower()
        if c and key not in seen:
            seen.add(key)
            yield c


def lookup_lyrics(artist: str, title: str) -> Optional[str]:
    """Fetch lyrics from LyricsOVH (free, no API key required).

    LyricsOVH is sensitive to exact punctuation in the title, so we try a few
    normalised spellings (e.g. apostrophe-stripped) before giving up.
    """
    for variant in _title_variants(title):
        lyrics = _fetch_lyrics_ovh(artist, variant)
        if lyrics:
            if variant != title:
                logger.info("Lyrics found via title variant '%s' (orig '%s')", variant, title)
            return lyrics
    logger.warning("Lyrics not found for '%s – %s' (tried %d variants)",
                   artist, title, len(list(_title_variants(title))))
    return None


def extract_youtube_title(url: str) -> Optional[str]:
    """Return the video title string, trying pytubefix first then yt-dlp."""
    # pytubefix: pure Python, no JS needed, works on cloud IPs with OAuth token
    try:
        import os
        from pathlib import Path
        from pytubefix import YouTube
        token_file = str(Path(os.environ.get("PP_TEMP_DIR", "./temp")).parent / "yt_oauth_token.json")
        use_oauth = Path(token_file).exists()
        return YouTube(url, use_oauth=use_oauth, allow_oauth_cache=True,
                       token_file=token_file if use_oauth else None).title
    except Exception as e:
        logger.warning("pytubefix title extraction failed: %s", e)

    # Fallback: yt-dlp (may fail on cloud IPs but worth trying)
    try:
        res = subprocess.run(
            ["yt-dlp", "--print", "title", "--no-playlist", url],
            capture_output=True, text=True, timeout=30,
        )
        title = res.stdout.strip()
        return title if title else None
    except Exception as e:
        logger.warning("yt-dlp title extraction also failed: %s", e)
        return None


def parse_artist_title(raw: str) -> Tuple[str, str]:
    """Split 'Artist – Song Title' or 'Artist - Song Title' strings."""
    for sep in [" – ", " - ", "–", " | "]:
        if sep in raw:
            artist, title = raw.split(sep, 1)
            return artist.strip(), title.strip()
    return "", raw.strip()


def lyrics_to_prompt(lyrics: str, max_chars: int = 400) -> str:
    """Return the first max_chars of lyrics, suitable as a Whisper initial_prompt."""
    clean = lyrics.replace("\r\n", "\n").replace("\r", "\n")
    lines = [l.strip() for l in clean.splitlines() if l.strip()]
    prompt = " ".join(lines)
    return prompt[:max_chars]

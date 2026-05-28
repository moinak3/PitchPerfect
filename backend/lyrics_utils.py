import json
import logging
import subprocess
import urllib.parse
import urllib.request
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def lookup_lyrics(artist: str, title: str) -> Optional[str]:
    """Fetch lyrics from LyricsOVH (free, no API key required)."""
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
            lyrics = data.get("lyrics", "").strip()
            return lyrics or None
    except Exception as e:
        logger.warning("Lyrics lookup failed for '%s – %s': %s", artist, title, e)
        return None


def extract_youtube_title(url: str) -> Optional[str]:
    """Return the video title string using yt-dlp --print title."""
    try:
        res = subprocess.run(
            ["yt-dlp", "--print", "title", "--no-playlist", url],
            capture_output=True, text=True, timeout=30,
        )
        title = res.stdout.strip()
        return title if title else None
    except Exception as e:
        logger.warning("Could not extract YouTube title: %s", e)
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

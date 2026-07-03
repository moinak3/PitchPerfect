import json
import logging
import re
import subprocess
import time
import urllib.parse
import urllib.request
import urllib.error
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def _fetch_lyrics_ovh(artist: str, title: str, retries: int = 3) -> Optional[str]:
    """Single-spelling LyricsOVH request with retry on transient failures.

    LyricsOVH (a free API) intermittently drops connections / times out.  A
    hard failure here silently disables forced alignment downstream, so we
    retry transient errors a few times with backoff.  A 404, by contrast, is
    a definitive "not found under this spelling" — we return immediately so the
    caller can try the next title variant.
    """
    url = (
        "https://api.lyrics.ovh/v1/"
        + urllib.parse.quote(artist.strip())
        + "/"
        + urllib.parse.quote(title.strip())
    )
    last_err: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PitchPerfect/1.0"})
            with urllib.request.urlopen(req, timeout=12) as r:
                data = json.loads(r.read())
                lyrics = (data.get("lyrics") or "").strip()
                return lyrics or None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None  # not found under this spelling — try a variant
            last_err = e  # 5xx / rate limit — worth retrying
        except Exception as e:
            last_err = e  # connection reset / timeout / DNS — transient
        if attempt < retries - 1:
            time.sleep(0.6 * (attempt + 1))  # 0.6s, 1.2s backoff
    logger.warning("Lyrics lookup failed for '%s – %s' after %d tries: %s",
                   artist, title, retries, last_err)
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

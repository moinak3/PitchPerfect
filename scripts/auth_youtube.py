"""
Run once to generate a YouTube OAuth token for the Modal deployment.

Usage:
    cd ~/Projects/PitchPerfect
    source .venv/bin/activate
    python scripts/auth_youtube.py

It will print a URL + short code. Open the URL in your browser,
enter the code, and approve access. Then run:

    modal volume put pitchperfect-data /tmp/yt_oauth_token.json /yt_oauth_token.json
"""
from pytubefix import YouTube

TOKEN_FILE = "/tmp/yt_oauth_token.json"

print("Authenticating with YouTube...")
print("When prompted, open the URL in your browser and enter the device code.\n")

yt = YouTube(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    use_oauth=True,
    allow_oauth_cache=True,
    token_file=TOKEN_FILE,
)

print(f"\nSuccess! Title: {yt.title}")
print(f"Token saved to {TOKEN_FILE}")
print("\nNow upload to Modal:")
print(f"  modal volume put pitchperfect-data {TOKEN_FILE} /yt_oauth_token.json")

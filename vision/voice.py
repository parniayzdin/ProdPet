"""
Text-to-speech for BunBun.

macOS prototype uses the built-in `say` command.
Later we can swap this file for a Raspberry Pi / other engine
without changing callers — they only use speak(text).
"""

from __future__ import annotations

import shutil
import subprocess


def speak(text: str, *, voice: str | None = None) -> None:
    """Speak text out loud. No-op if text is empty."""
    text = (text or "").strip()
    if not text:
        return

    say = shutil.which("say")
    if say is None:
        print(f"[voice] `say` not found; would have said: {text}")
        return

    cmd = [say]
    if voice:
        cmd.extend(["-v", voice])
    cmd.append(text)

    # Block until finished so mouth animation (later) can sync with speech end
    subprocess.run(cmd, check=False)


if __name__ == "__main__":
    speak("Hello! I am BunBun, your tiny desk buddy.", voice="Junior")
    print("If you heard that, Step 3 works.")

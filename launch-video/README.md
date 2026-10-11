# Vertical launch video

A 9:16 motion edit made from headless recordings of the live Ringtone Cropper website. This version is designed for vertical viewing in Shorts, Reels, and Stories. The landscape edition has been removed.

## Deliverables

Rendered files live in `exports/` locally. Recordings, exported audio, graphics, and render caches are excluded from Git; the edit manifest and renderer are tracked.

- `launch-vertical-v2.mp4`: the complete vertical film with the selected example audio and original sound effects.
- `launch-vertical-v2-no-music.mp4`: the same edit with original sound effects only, for adding your own soundtrack.
- `cover-vertical-v2.png`: a matching portrait cover.
- `vertical-launch-kit-v2.zip`: the vertical deliverables and the actual exported ringtone.

The videos are 1080 × 1920 at 60 fps, run for 30.85 seconds, and use H.264 with AAC audio and MP4 fast-start. Important captions, actions, and the final URL are positioned away from the outer edges to leave room for platform controls.

## What the video shows

The edit opens on the actual waveform, then follows a real import, selection move, handle resize, exact 30-second preset, fade-in/fade-out toggles, preview, phone format selection, and successful download. Large crops keep the relevant controls readable. Motion treatments include animated typography, varied camera moves, directional transitions, and highlights timed to interactions.

The soundtrack includes a brief opening teaser and a preview synchronized to the exported selection. Audio fades and original transition sounds tie the cuts together. Versions without the song retain only the original sound design.

## Recording source

- Website: https://ringtone.apoorvdarshan.com
- User-selected YouTube example: https://www.youtube.com/watch?v=CnEqrgMlWLQ
- Imported title: **I Think They Call This Love (Cover)**.
- Final source interval: **97.2–127.2 seconds**, exported as a 30-second M4A for iPhone / GarageBand.
- The resizing demonstration briefly shortens the selection to **20.6 seconds** before the 30-second preset restores it.
- Both fade-in and fade-out are visibly enabled before the final preview and export.

All product footage is the actual responsive website. Processing waits are shortened through edits. Decorative motion graphics and callouts are separate from the recorded controls.

## Re-render

Requires Python 3, Pillow, and FFmpeg with the `libx264` encoder. Keep the local `raw/` recordings and demonstration audio in `exports/` to reproduce the edit.

```sh
cd launch-video
python3 -m venv .venv
.venv/bin/pip install Pillow
.venv/bin/python render.py edit-vertical.json --output exports/launch-vertical-v2.mp4 --clean-output exports/launch-vertical-v2-no-music.mp4
```

The renderer downloads DM Sans and Instrument Serif from the Google Fonts repository on its first run and caches them locally. The manifest specifies footage, timing, crops, camera moves, captions, transitions, and audio synchronization. Use `--force` to rebuild cached shots after changing the renderer. `--clean-output` retains original sound effects; `--silent-output` creates a completely silent master.

## Capture another take

Use an isolated, logged-out, headless browser session. The pointer is included in the recording.

```sh
agent-browser --session ringtone-vertical open https://ringtone.apoorvdarshan.com
agent-browser --session ringtone-vertical set viewport 430 932 2
agent-browser --session ringtone-vertical record start raw/new-vertical-take.mp4 --fps 30 --cursor
# Perform the real application actions in this session.
agent-browser --session ringtone-vertical record stop
agent-browser --session ringtone-vertical close
```

The manifest crops use recording pixels, including the device scale factor. Fresh close-up recordings for this revision are in `raw/vertical-v2/`.

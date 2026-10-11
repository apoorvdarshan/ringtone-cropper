# Launch video

Headless recordings of the live Ringtone Cropper website, edited into a landscape launch film and a vertical social cut. The footage shows a real YouTube import, waveform selection, preview, device format choice, and browser download.

## Deliverables

Rendered files live in `exports/` locally. Recordings, exported audio, generated graphics, and render caches are excluded from Git; the edit manifests and renderer are tracked.

- Landscape: 1920 × 1080, 30 fps, 35.5 seconds.
- Vertical: 1080 × 1920, 30 fps, 26.1 seconds.
- H.264 video, AAC audio, and MP4 fast-start for playback on the web.
- Alternate versions without the demonstration song are also provided.

Files: `launch-landscape.mp4`, `launch-vertical.mp4`, their `-no-music.mp4` alternatives, and landscape/vertical PNG covers. `launch-kit.zip` bundles these deliverables.

The edit uses animated typography, an animated brand waveform, eased camera moves, chapter transitions, and original sound effects. Processing waits are shortened through cuts. The source audio starts with the actual preview action.

## Recording source

- Website: https://ringtone.apoorvdarshan.com
- User-selected YouTube example: https://www.youtube.com/watch?v=CnEqrgMlWLQ
- Imported title: **I Think They Call This Love (Cover)**.
- Desktop demonstration: source interval 110.9–140.9 seconds, exported as a 30-second 320 kb/s MP3.
- Mobile demonstration: source interval 96.8–126.8 seconds, exported as a 30-second M4A for iPhone / GarageBand.

The recordings use the actual responsive website. There are no simulated success screens or substituted waveform graphics. The decorative waveform on the opening title is a separate motion graphic.

## Re-render

Requires Python 3, Pillow, and FFmpeg with the `libx264` encoder. Keep the local `raw/` recordings and demonstration audio in `exports/` to reproduce the supplied edits.

```sh
cd launch-video
python3 -m venv .venv
.venv/bin/pip install Pillow
.venv/bin/python render.py edit-landscape.json --output exports/launch-landscape.mp4 --clean-output exports/launch-landscape-no-music.mp4
.venv/bin/python render.py edit-vertical.json --output exports/launch-vertical.mp4 --clean-output exports/launch-vertical-no-music.mp4
```

The renderer downloads the website's open fonts, DM Sans and Instrument Serif, from the Google Fonts repository on its first run and caches them locally. Each manifest specifies the source footage, timing, crop, camera movement, caption, and audio synchronization. Use `--force` to rebuild cached shots after changing the renderer. The `--clean-output` versions retain original sound effects; use `--silent-output` for a completely silent master.

## Capture another take

Browser recording uses an isolated, logged-out, headless `agent-browser` session. The animated pointer is included in the recording.

```sh
agent-browser --session ringtone-launch open https://ringtone.apoorvdarshan.com
agent-browser --session ringtone-launch set viewport 1600 1000 1.2
agent-browser --session ringtone-launch record start raw/new-desktop-take.mp4 --fps 30 --cursor
# Perform the real application actions in this session.
agent-browser --session ringtone-launch record stop
agent-browser --session ringtone-launch close
```

For mobile takes, use `set viewport 430 932 2`. The manifest crops are in recording pixels, including the device scale factor.

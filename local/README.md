# Ringtone Cropper

A local ringtone editor with two audio sources: paste a YouTube video link, or choose **Upload audio file** in the source dropdown to select or drop a file.

## Run

Install Node.js 22 or later, FFmpeg (including ffprobe), and yt-dlp. On macOS with Homebrew:

```sh
brew install node ffmpeg yt-dlp
npm start
```

Open http://localhost:3005. There are no npm dependencies to install. Use `PORT=3006 npm start` to choose another port.

## Use

1. Choose **YouTube link** or **Upload audio file** and load your audio.
2. Drag the waveform selection, move the start slider, or use the half-second nudge buttons.
3. Set a clip length of up to 40 seconds and optionally enable fades.
4. Preview the clip, then save M4R for iPhone, MP3, or lossless WAV. Files are saved in this computer's Downloads folder with unique names.

Imports support sources up to 100 MiB and 20 minutes. The previous clip remains usable if a new import fails. If the original Iris MP3 is present in Downloads, it remains available as the initial source; it is not required.

## Audio quality

- YouTube imports select yt-dlp's best available audio stream and keep it in its original format.
- Uploaded media is retained unchanged. A separate float PCM WAV is used for browser waveform decoding and preview, without an intermediate lossy encode.
- Exports read the original source: AAC at 320 kb/s for M4R, MP3 at 320 kb/s with LAME's highest-effort setting, or float PCM for lossless WAV. Sample rates are preserved where the output codec supports them. Compressed ringtone formats downmix multichannel sources to stereo when necessary.
- Fades apply to both preview and export. WAV avoids additional lossy compression; it cannot restore detail missing from a compressed source.

The app runs locally on the loopback interface. Imported audio is temporary and is cleaned up when the server stops; exported files remain in Downloads. YouTube videos must be accessible to yt-dlp without signing in. If a public video stops importing, updating yt-dlp often resolves extractor changes.

## Checks

```sh
npm run check
npm test
```

Backend tests use generated audio and temporary directories. They do not require a live YouTube download.

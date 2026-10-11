# Ringtone Cropper

Crop any song or audio/video file into an iPhone ringtone, right in the browser.

**Live:** https://ringtone.apoorvdarshan.com

- Drag-and-drop mp3, m4a, wav, flac, aac, ogg, mp4, mov…
- iOS-style trim editor: drag the yellow frame or its ends (29.9s / 40s / 15s presets), live preview + repeat
- Starts on the loudest stretch of the song, which is usually the chorus
- Fade in/out, loudness normalization
- Export **.m4r** (iPhone ringtone), .m4a, .mp3, .wav
- 100% client-side via [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — audio never leaves your device

## Dev

```sh
npm install
npm run dev     # local preview
npm run deploy  # deploy to Cloudflare Workers (static assets)
```

`public/vendor/` contains `@ffmpeg/ffmpeg` and `@ffmpeg/util` ESM builds; the ffmpeg core (~32 MB wasm) is loaded from jsDelivr since it exceeds Cloudflare's 25 MiB asset limit.

## Local editor with YouTube import

The [local editor](local/README.md) adds a **YouTube link / Upload audio file** dropdown, file drag-and-drop, waveform selection, and preview with fades. It downloads YouTube's best available audio stream and preserves uploaded originals. Exports use 320 kb/s AAC for M4R, 320 kb/s MP3, or lossless WAV and save to this computer's Downloads folder.

Install Node.js 22 or later, FFmpeg (including ffprobe), and yt-dlp, then run:

```sh
brew install node ffmpeg yt-dlp  # macOS prerequisites
npm run local
```

Open http://localhost:3005. No npm dependency install is needed for the local editor. Imports and audio processing run on your computer using Node, FFmpeg, and yt-dlp. This version lives in `local/`; the deployed browser editor remains in `public/`. The static Cloudflare deployment does not run the local YouTube importer.

To check the local editor:

```sh
npm --prefix local run check
npm --prefix local test
```

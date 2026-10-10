# Ringtone Cropper

Crop any song or audio/video file into an iPhone ringtone, right in the browser.

**Live:** https://ringtone.apoorvdarshan.com

- Drag-and-drop mp3, m4a, wav, flac, aac, ogg, mp4, mov…
- Waveform with draggable 29.9s / 40s / 15s / custom selection, live preview + loop
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

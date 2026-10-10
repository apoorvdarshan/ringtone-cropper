# Ringtone Cropper

Crop any song or audio/video file into an iPhone ringtone, right in the browser.

**Live:** https://ringtone.apoorvdarshan.com

- Drag-and-drop mp3, m4a, wav, flac, aac, ogg, mp4, mov…
- iOS-style trim editor: drag the yellow frame or its ends (29.9s / 40s / 15s presets), live preview + repeat
- Close-up of the clip under the song overview: drag it to fine-tune, and it shows the fade-in/out shape live
- Editable ringtone name, used as the file name and shown in the iPhone ringtone list
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

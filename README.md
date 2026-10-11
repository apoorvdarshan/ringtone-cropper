# Ringtone Cropper

Crop a YouTube video or an audio/video file into an iPhone ringtone.

**Live:** https://ringtone.apoorvdarshan.com

- Choose **YouTube link** or **Upload audio file** in the source dropdown
- Download YouTube's best available original audio, or drag-and-drop mp3, m4a, wav, flac, aac, ogg, mp4, mov…
- iOS-style trim editor: drag the yellow frame or its ends (29.9s / 40s / 15s presets), live preview + repeat
- Starts on the loudest stretch of the song, which is usually the chorus
- Fade in/out, loudness normalization
- Export **.m4r** (iPhone ringtone), .m4a and .mp3 at 320 kb/s, or lossless float WAV
- Uploaded files stay on your device; waveform preview and export run in the browser via [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)
- YouTube audio is downloaded by a private backend, sent to your browser without lossy conversion, and immediately removed from the server

## Dev

```sh
npm install
npm run dev     # local Worker + container preview (requires Docker)
npm run deploy  # deploy the public editor and API gateway to Cloudflare
```

`public/vendor/` contains `@ffmpeg/ffmpeg` and `@ffmpeg/util` ESM builds; the ffmpeg core (~32 MB wasm) is loaded from jsDelivr since it exceeds Cloudflare's 25 MiB asset limit.

## Hosted YouTube backend

`worker.mjs` serves the same-origin `/api/youtube` endpoint and streams the original audio back to the browser. `cloudflare.mjs` connects it to a Cloudflare Container running the standalone Node service and yt-dlp in `backend/`. The gateway validates video URLs, rejects cross-site browser requests, and limits imports to ten per minute per IP. The backend requires a shared token, allows two simultaneous downloads, and enforces 100 MiB / 20-minute limits and a four-minute processing timeout. Private, live, and otherwise unavailable videos return an error; uploaded files can still be cropped.

Production runs entirely on Cloudflare: static assets, the Worker gateway, and one `basic` Container that sleeps after 60 seconds of inactivity. `wrangler.jsonc` pins the backend image by digest in Cloudflare's registry. No Google Cloud service is needed. A first import may take longer while the container starts.

Set a random token of at least 24 characters with `wrangler secret put BACKEND_TOKEN`. The Worker passes the secret into the container; it must never appear in browser code or Git. `npm run deploy` deploys the frontend, gateway, and container configuration together. When changing `backend/server.js` or its Dockerfile, build and push a new image with `wrangler containers build -p -t ringtone-cropper-api ./backend` (requires Docker), then update the image digest in `wrangler.jsonc` before deploying. Frontend-only updates reuse the pinned image.

For local Worker development, put a development-only `BACKEND_TOKEN` in the ignored `.dev.vars` file and run `npm run dev` with Docker available. The separate local editor below requires no container. The gateway also supports `YOUTUBE_BACKEND_URL` when adapting it to an external backend.

```sh
npm run check
npm test
```

Tests cover gateway routing, token authentication, download limits, concurrent requests, cancellation, temporary-file cleanup, audio fidelity, and exports. Real YouTube access must also be checked after backend deployment because YouTube may challenge cloud IP addresses.

## Local editor with YouTube import

The [local editor](local/README.md) adds a **YouTube link / Upload audio file** dropdown, file drag-and-drop, waveform selection, and preview with fades. It downloads YouTube's best available audio stream and preserves uploaded originals. Exports use 320 kb/s AAC for M4R, 320 kb/s MP3, or lossless WAV and save to this computer's Downloads folder.

Install Node.js 22 or later, FFmpeg (including ffprobe), and yt-dlp, then run:

```sh
brew install node ffmpeg yt-dlp  # macOS prerequisites
npm run local
```

Open http://localhost:3005. No npm dependency install is needed for the local editor. Imports and audio processing run on your computer using Node, FFmpeg, and yt-dlp. This version lives in `local/`; the public editor lives in `public/` and uses the hosted backend described above.

To check the local editor:

```sh
npm --prefix local run check
npm --prefix local test
```

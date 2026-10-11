const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_DURATION = 20 * 60;
const MAX_PREVIEW_BYTES = 1024 * 1024 * 1024;
const FORMATS = 'wav,mp3,flac,ogg,mov,matroska,webm,aac,aiff,asf,amr,ac3,eac3';
const MEDIA_INPUT = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', FORMATS];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validateYouTubeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new HttpError(400, 'Enter a valid YouTube video link.');
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Enter a valid YouTube video link.'); }
  const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
  if (!hosts.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new HttpError(400, 'Use a public youtube.com or youtu.be video link.');
  }
  const videoId = url.hostname.endsWith('youtu.be')
    ? url.pathname.slice(1)
    : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new HttpError(400, 'Use a link to one YouTube video, not a channel or playlist.');
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    end = Math.min(end, size - 1);
  }
  return start >= size || start > end || start < 0 ? null : { start, end };
}

function publicSource(source) {
  if (!source) return null;
  const channels = source.channels === 1 ? 'mono' : source.channels === 2 ? 'stereo' : `${source.channels} channels`;
  return {
    id: source.id, title: source.title, duration: source.duration,
    audioUrl: `/audio?id=${source.id}`, sourceKind: source.sourceKind,
    quality: `${source.codec.toUpperCase()} original · ${source.sampleRate / 1000} kHz · ${channels}`,
  };
}

function createApp(options = {}) {
  const downloadDir = options.downloadDir || path.join(os.homedir(), 'Downloads');
  const legacySource = options.legacySource === undefined
    ? path.join(downloadDir, 'Goo Goo Dolls – Iris [Official Music Video] [4K Remaster].mp3') : options.legacySource;
  const dataDir = fs.mkdtempSync(path.join(options.tempDir || os.tmpdir(), 'ringtone-cropper-'));
  const sources = new Map();
  const children = new Set();
  let currentId = null, activeJobs = 0, closing = false;

  function run(command, args, { timeout = 90_000, watchDirectory = null } = {}) {
    return new Promise((resolve, reject) => {
      let oversized = false;
      const child = execFile(command, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        children.delete(child);
        clearInterval(watcher);
        if (oversized) return reject(new HttpError(413, 'Audio must be 100 MiB or smaller.'));
        if (error) {
          if (error.code === 'ENOENT') return reject(new HttpError(503, `${command} is not installed. See the setup instructions.`));
          if (error.killed) return reject(new HttpError(504, 'Audio processing timed out. Try a shorter file or video.'));
          error.stderr = stderr;
          return reject(error);
        }
        resolve(stdout);
      });
      children.add(child);
      const watcher = watchDirectory ? setInterval(() => {
        try {
          const size = fs.readdirSync(watchDirectory).reduce((sum, name) => sum + fs.statSync(path.join(watchDirectory, name)).size, 0);
          if (size > MAX_BYTES + 1024 * 1024) { oversized = true; child.kill('SIGKILL'); }
        } catch { /* A completed job may already have removed its directory. */ }
      }, 250) : null;
    });
  }

  async function probe(filename) {
    let details;
    try {
      details = JSON.parse(await run('ffprobe', ['-v', 'error', ...MEDIA_INPUT, '-select_streams', 'a:0', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels,duration', '-of', 'json', filename]));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'This file could not be read as audio. Try MP3, M4A, WAV, FLAC, OGG, or WebM.');
    }
    const audio = details.streams?.[0];
    const duration = Number(audio?.duration || details.format?.duration);
    const sampleRate = Number(audio?.sample_rate);
    if (!audio || !Number.isFinite(duration) || duration < 0.05 || !Number.isFinite(sampleRate) || sampleRate <= 0 || !audio.channels) {
      throw new HttpError(400, 'The file needs a playable audio track with a known duration.');
    }
    if (duration > MAX_DURATION) throw new HttpError(400, 'Choose audio that is 20 minutes or shorter.');
    if (duration * sampleRate * audio.channels * 4 > MAX_PREVIEW_BYTES - 65536) {
      throw new HttpError(413, 'This high-resolution audio is too large to preview. Upload a shorter section.');
    }
    return { duration, sampleRate, channels: audio.channels, codec: audio.codec_name || 'audio' };
  }

  async function evictOldSources() {
    for (const [id, source] of sources) {
      if (sources.size <= 5) break;
      if (id !== currentId && !source.inUse) {
        sources.delete(id);
        await fsp.rm(source.directory, { recursive: true, force: true });
      }
    }
  }

  async function importMedia(filename, title, sourceKind, directory) {
    if ((await fsp.stat(filename)).size > MAX_BYTES) throw new HttpError(413, 'Audio must be 100 MiB or smaller.');
    const metadata = await probe(filename);
    const preview = path.join(directory, 'preview.wav');
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...MEDIA_INPUT, '-i', filename,
        '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_f32le', '-fs', String(MAX_PREVIEW_BYTES), '-f', 'wav', preview]);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'This audio could not be prepared for playback. Try another audio file.');
    }
    if ((await fsp.stat(preview)).size >= MAX_PREVIEW_BYTES) throw new HttpError(413, 'This audio is too large to preview. Upload a shorter section.');
    const source = { id: randomUUID(), title: String(title).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200), sourceKind,
      filename, preview, directory, inUse: 0, ...metadata };
    if (closing) throw new HttpError(503, 'The server is shutting down.');
    sources.set(source.id, source);
    currentId = source.id;
    await evictOldSources();
    return publicSource(source);
  }

  function sendJson(res, status, body) {
    if (res.destroyed || res.headersSent) return;
    const content = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(content), 'Cache-Control': 'no-store' });
    res.end(content);
  }

  async function readJson(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send a JSON request.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 8192) throw new HttpError(413, 'The request is too large.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'Send a valid JSON request.'); }
  }

  async function withJob(job) {
    if (activeJobs >= 2) throw new HttpError(429, 'Two audio jobs are already running. Please wait and try again.');
    activeJobs++;
    try { return await job(); } finally { activeJobs--; }
  }

  async function upload(req) {
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > MAX_BYTES) throw new HttpError(413, 'Audio must be 100 MiB or smaller.');
    let title;
    try { title = decodeURIComponent(req.headers['x-filename'] || 'Uploaded audio'); }
    catch { throw new HttpError(400, 'The filename is invalid.'); }
    title = path.basename(title).replace(/\.[a-zA-Z0-9]{1,8}$/, '') || 'Uploaded audio';
    const directory = await fsp.mkdtemp(path.join(dataDir, 'upload-'));
    const filename = path.join(directory, 'original');
    let size = 0;
    try {
      // Keep the request outside pipeline so oversized uploads can still receive JSON.
      const output = fs.createWriteStream(filename, { flags: 'wx' });
      const limiter = new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length;
        callback(size > MAX_BYTES ? new HttpError(413, 'Audio must be 100 MiB or smaller.') : null, chunk);
      } });
      req.pipe(limiter);
      const onAborted = () => limiter.destroy(new HttpError(400, 'Upload interrupted.'));
      req.once('aborted', onAborted);
      try { await pipeline(limiter, output); }
      finally { req.off('aborted', onAborted); req.unpipe(limiter); }
      if (!size) throw new HttpError(400, 'Choose a non-empty audio file.');
      return await importMedia(filename, title, 'upload', directory);
    } catch (error) {
      req.resume();
      await fsp.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async function youtube(req) {
    const body = await readJson(req);
    const url = validateYouTubeUrl(body?.url);
    const directory = await fsp.mkdtemp(path.join(dataDir, 'youtube-'));
    try {
      try {
        await run('yt-dlp', ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-cache-dir',
          '--no-part', '--no-continue', '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2',
          '--max-filesize', String(MAX_BYTES), '--match-filter', `!is_live & duration <= ${MAX_DURATION}`,
          '-f', 'bestaudio/best', '--write-info-json', '-o', path.join(directory, 'original.%(ext)s'), '--', url],
          { timeout: 300_000, watchDirectory: directory });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (/sign in|confirm.*bot|login required/i.test(error.stderr || '')) throw new HttpError(422, 'YouTube requires sign-in for this video. Try a public video or upload an audio file.');
        throw new HttpError(422, 'YouTube could not provide this audio. Check that the video is public, available, and no longer than 20 minutes.');
      }
      const names = await fsp.readdir(directory);
      const media = names.find(name => /^original\.[a-zA-Z0-9]+$/.test(name) && !name.endsWith('.json'));
      if (!media) throw new HttpError(422, 'Choose a public video under 20 minutes with audio smaller than 100 MiB. Live streams are not supported.');
      let title = 'YouTube audio';
      const infoName = names.find(name => name.endsWith('.info.json'));
      if (infoName) {
        const info = JSON.parse(await fsp.readFile(path.join(directory, infoName), 'utf8'));
        title = info.title || title;
        await fsp.unlink(path.join(directory, infoName));
      }
      return await importMedia(path.join(directory, media), title, 'youtube', directory);
    } catch (error) {
      await fsp.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async function serveFile(req, res, filename, type, extraHeaders = {}) {
    let stat;
    try { stat = await fsp.stat(filename); }
    catch { throw new HttpError(404, 'The audio file is no longer available. Import it again.'); }
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...extraHeaders };
    let range;
    if (req.headers.range) {
      range = parseRange(req.headers.range, stat.size);
      if (!range) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0 });
        return res.end();
      }
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    }
    headers['Content-Length'] = range ? range.end - range.start + 1 : stat.size;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();
    try { await pipeline(fs.createReadStream(filename, range || {}), res); }
    catch (error) { if (!res.destroyed) res.destroy(error); }
  }

  function getSource(url) {
    const source = sources.get(url.searchParams.get('id') || currentId);
    if (!source) throw new HttpError(404, 'Choose a YouTube link or upload audio first.');
    return source;
  }

  async function exportClip(req, res, url) {
    const source = getSource(url);
    const start = Number(url.searchParams.get('start') || 0);
    const requestedDuration = Number(url.searchParams.get('dur') || 30);
    const format = url.searchParams.get('fmt') || 'm4r';
    if (!Number.isFinite(start) || start < 0 || start >= source.duration || !Number.isFinite(requestedDuration) || requestedDuration <= 0 || requestedDuration > 40) {
      throw new HttpError(400, 'Choose a valid start time and a clip length of up to 40 seconds.');
    }
    if (!['m4r', 'mp3', 'wav'].includes(format)) throw new HttpError(400, 'Choose M4R, MP3, or WAV.');
    const duration = Math.min(requestedDuration, source.duration - start);
    if (duration < 0.05) throw new HttpError(400, 'Choose a longer section of audio.');
    const stem = source.title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 70) || 'Audio';
    const name = `${stem} ${start.toFixed(1)}s-${(start + duration).toFixed(1)}s ${randomUUID().slice(0, 8)}.${format}`;
    const destination = path.join(downloadDir, name);
    const temporary = path.join(dataDir, `${randomUUID()}.${format}`);
    source.inUse++;
    try {
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(start), ...MEDIA_INPUT, '-i', source.filename,
        '-t', String(duration), '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1'];
      if (url.searchParams.get('fade') === '1') {
        const fadeIn = Math.min(0.5, duration / 2), fadeOut = Math.min(1, duration / 2);
        args.push('-af', `afade=t=in:d=${fadeIn},afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`);
      }
      if (format !== 'wav' && source.channels > 2) args.push('-ac', '2');
      if (format === 'm4r') {
        if (source.sampleRate > 96000) args.push('-ar', '96000');
        args.push('-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', '-f', 'ipod');
      } else if (format === 'mp3') {
        // MPEG-2/2.5 silently cap low-rate MP3 at 160/64 kb/s. Use MPEG-1
        // for the requested 320 kb/s; keep an integer sample-rate ratio where possible.
        if (source.sampleRate < 32000) args.push('-ar', source.sampleRate % 11025 === 0 ? '44100' : '48000');
        if (source.sampleRate > 48000) args.push('-ar', '48000');
        args.push('-c:a', 'libmp3lame', '-b:a', '320k', '-compression_level', '0', '-f', 'mp3');
      } else args.push('-c:a', 'pcm_f32le', '-f', 'wav');
      args.push(temporary);
      try { await run('ffmpeg', args); }
      catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(500, 'The clip could not be exported. Try a different format or selection.');
      }
      await fsp.mkdir(downloadDir, { recursive: true });
      // Exclusive copy also works when Downloads is on another volume.
      await fsp.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
      await serveFile(req, res, destination, format === 'm4r' ? 'audio/mp4' : format === 'mp3' ? 'audio/mpeg' : 'audio/wav', {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Saved-Path': encodeURIComponent(destination),
      });
    } finally {
      source.inUse--;
      await fsp.rm(temporary, { force: true });
      await evictOldSources();
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const host = new URL(`http://${req.headers.host || 'invalid'}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) throw new HttpError(403, 'Open this app on localhost.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== host.origin)) {
        throw new HttpError(403, 'Use the app in this browser tab to import or export audio.');
      }
      const url = new URL(req.url, host);
      await server.ready;
      if (req.method === 'GET' && url.pathname === '/api/source') return sendJson(res, 200, { source: publicSource(sources.get(currentId)) });
      if (req.method === 'POST' && url.pathname === '/api/upload') return sendJson(res, 201, await withJob(() => upload(req)));
      if (req.method === 'POST' && url.pathname === '/api/youtube') return sendJson(res, 201, await withJob(() => youtube(req)));
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/audio') {
        const source = getSource(url);
        source.inUse++;
        try { return await serveFile(req, res, source.preview, 'audio/wav'); }
        finally { source.inUse--; await evictOldSources(); }
      }
      if (req.method === 'GET' && url.pathname === '/export') return await withJob(() => exportClip(req, res, url));
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/app.js') return await serveFile(req, res, path.join(__dirname, 'app.js'), 'application/javascript; charset=utf-8');
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/style.css') return await serveFile(req, res, path.join(__dirname, 'style.css'), 'text/css; charset=utf-8');
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/') return await serveFile(req, res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      req.resume();
      if (!(error instanceof HttpError)) console.error('Request failed:', error.message);
      sendJson(res, error.status || 500, { error: error instanceof HttpError ? error.message : 'Something went wrong while processing audio. Please try again.' });
    }
  });
  server.requestTimeout = 90_000;
  server.headersTimeout = 10_000;
  server.ready = (async () => {
    if (!legacySource || !fs.existsSync(legacySource)) return;
    const directory = await fsp.mkdtemp(path.join(dataDir, 'existing-'));
    try { await importMedia(legacySource, path.basename(legacySource, path.extname(legacySource)), 'existing', directory); }
    catch (error) { console.warn(`Existing audio was not loaded: ${error.message}`); await fsp.rm(directory, { recursive: true, force: true }); }
  })();
  server.on('close', () => {
    closing = true;
    for (const child of children) child.kill('SIGKILL');
    fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
}

module.exports = { createApp, parseRange, validateYouTubeUrl };

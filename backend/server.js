'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, timingSafeEqual } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_DURATION = 20 * 60;
const JOB_TIMEOUT = 240_000;
const MIME_TYPES = {
  webm: 'audio/webm', m4a: 'audio/mp4', mp4: 'audio/mp4',
  ogg: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg',
  aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validateYouTubeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new HttpError(400, 'Enter a valid YouTube video link.');
  }
  let url;
  try { url = new URL(value); }
  catch { throw new HttpError(400, 'Enter a valid YouTube video link.'); }
  const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
  if (!hosts.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new HttpError(400, 'Use a public youtube.com or youtu.be video link.');
  }
  if (url.searchParams.has('list')) throw new HttpError(400, 'Use a link to one YouTube video without a playlist.');
  const id = url.hostname.endsWith('youtu.be')
    ? url.pathname.slice(1)
    : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    throw new HttpError(400, 'Use a link to one YouTube video, not a channel or playlist.');
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

function abortReason(signal) {
  return signal?.reason instanceof HttpError ? signal.reason : new HttpError(499, 'The request was canceled.');
}

// A process group ensures aborts also stop yt-dlp's JavaScript challenge subprocesses.
function runProcess(command, args, { signal, directory, timeout = JOB_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const child = spawn(command, args, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let failure, outputBytes = 0, stdout = '', stderr = '', settled = false;
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* The process may already have exited. */ }
    };
    const stop = (error) => { failure ||= error; kill(); };
    const onAbort = () => stop(abortReason(signal));
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop(new HttpError(504, 'YouTube took too long. Try a shorter video or upload an audio file.')), timeout);
    timer.unref();
    const watcher = directory ? setInterval(() => {
      try {
        const size = fs.readdirSync(directory).reduce((sum, name) => sum + fs.lstatSync(path.join(directory, name)).size, 0);
        if (size > MAX_BYTES + 1024 * 1024) stop(new HttpError(413, 'Choose audio smaller than 100 MiB.'));
      } catch { /* The job directory may be in cleanup. */ }
    }, 200) : null;
    watcher?.unref();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(watcher);
      signal?.removeEventListener('abort', onAbort);
      if (failure || error) reject(failure || error);
      else resolve({ stdout, stderr });
    };
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > 2 * 1024 * 1024) return stop(new HttpError(502, 'YouTube could not provide this audio. Try another video.'));
        if (name === 'stdout') stdout += chunk; else stderr += chunk;
      });
    }
    child.once('error', () => finish(new HttpError(503, 'Audio import is temporarily unavailable.')));
    child.once('close', (code) => {
      if (code === 0) finish();
      else if (/sign[ -]?in|confirm.*bot|login required/i.test(stderr)) {
        finish(new HttpError(422, 'YouTube is requiring sign-in for this video. Try another public video or upload a file.'));
      }
      else finish(new HttpError(422, 'YouTube could not provide this audio. Use a public video under 20 minutes, or upload an audio file.'));
    });
    if (signal?.aborted) onAbort();
  });
}

function downloadArgs(url, directory) {
  return ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-cache-dir',
    '--no-part', '--no-continue', '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2',
    '--js-runtimes', 'node', '--max-filesize', String(MAX_BYTES),
    '--match-filter', `!is_live & duration <= ${MAX_DURATION}`, '-f', 'bestaudio',
    '--write-info-json', '-o', path.join(directory, 'original.%(ext)s'), '--', url];
}

async function downloadAudio(url, { directory, signal, run = runProcess }) {
  await run('yt-dlp', downloadArgs(url, directory), { signal, directory });
  const names = await fsp.readdir(directory);
  const media = names.find((name) => /^original\.[a-zA-Z0-9]+$/.test(name) && !name.endsWith('.json'));
  const infoName = names.find((name) => name === 'original.info.json');
  if (!media || !infoName) throw new HttpError(422, 'Choose a public video under 20 minutes with audio smaller than 100 MiB. Live streams are not supported.');
  let info;
  try { info = JSON.parse(await fsp.readFile(path.join(directory, infoName), 'utf8')); }
  catch { throw new HttpError(502, 'YouTube could not provide this audio. Try another video.'); }
  const duration = Number(info.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION || info.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) {
    throw new HttpError(422, 'Choose a video under 20 minutes. Live streams are not supported.');
  }
  if (!MIME_TYPES[path.extname(media).slice(1)]) throw new HttpError(422, 'This video has no supported audio format.');
  return { filename: path.join(directory, media), title: info.title || 'YouTube audio' };
}

function sendJson(res, status, body) {
  if (res.destroyed || res.headersSent) return;
  const content = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(content), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(content);
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send a JSON request.');
  if (Number(req.headers['content-length']) > 8192) throw new HttpError(413, 'The request is too large.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8192) throw new HttpError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Send a valid JSON request.'); }
}

function cleanTitle(value) {
  return String(value).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 180) || 'YouTube audio';
}

function createApp(options = {}) {
  const token = options.token ?? process.env.BACKEND_TOKEN;
  if (typeof token !== 'string' || token.length < 24) throw new Error('BACKEND_TOKEN must contain at least 24 characters.');
  const expectedAuth = createHash('sha256').update(`Bearer ${token}`).digest();
  const download = options.download || downloadAudio;
  const tempDir = options.tempDir || os.tmpdir();
  const logger = options.logger || console;
  const controllers = new Set();
  let activeJobs = 0;
  let closing = false;

  const server = http.createServer(async (req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname === '/health' && req.method === 'GET') {
      sendJson(res, closing ? 503 : 200, { ok: !closing }); return;
    }
    if (pathname !== '/api/youtube') { sendJson(res, 404, { error: 'Not found.' }); req.resume(); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); sendJson(res, 405, { error: 'Use POST for audio import.' }); req.resume(); return; }
    const actualAuth = createHash('sha256').update(req.headers.authorization || '').digest();
    if (!timingSafeEqual(actualAuth, expectedAuth)) { sendJson(res, 401, { error: 'Unauthorized.' }); req.resume(); return; }
    if (closing) { sendJson(res, 503, { error: 'Audio import is temporarily unavailable.' }); req.resume(); return; }
    if (activeJobs >= 2) { res.setHeader('Retry-After', '15'); sendJson(res, 429, { error: 'Audio import is busy. Wait a moment and try again.' }); req.resume(); return; }

    activeJobs++;
    const controller = new AbortController();
    const { signal } = controller;
    controllers.add(controller);
    const onDisconnect = () => { if (!res.writableFinished) controller.abort(new HttpError(499, 'The request was canceled.')); };
    req.once('aborted', onDisconnect);
    res.once('close', onDisconnect);
    const timer = setTimeout(() => controller.abort(new HttpError(504, 'YouTube took too long. Try a shorter video or upload an audio file.')), options.jobTimeout || JOB_TIMEOUT);
    timer.unref();
    let directory;
    try {
      const body = await readJson(req);
      const url = validateYouTubeUrl(body?.url);
      if (signal.aborted) throw abortReason(signal);
      directory = await fsp.mkdtemp(path.join(tempDir, 'ringtone-youtube-'));
      const result = await download(url, { directory, signal });
      if (signal.aborted) throw abortReason(signal);
      const realFile = await fsp.realpath(result.filename);
      const realDirectory = await fsp.realpath(directory);
      if (path.dirname(realFile) !== realDirectory) throw new Error('Download output escaped its temporary directory.');
      const stat = await fsp.stat(realFile);
      if (!stat.isFile() || !stat.size) throw new HttpError(422, 'This video has no playable audio.');
      if (stat.size > MAX_BYTES) throw new HttpError(413, 'Choose audio smaller than 100 MiB.');
      const extension = path.extname(realFile).slice(1).toLowerCase();
      if (!MIME_TYPES[extension]) throw new HttpError(422, 'This video has no supported audio format.');
      const title = cleanTitle(result.title);
      const filename = `${title.replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '') || 'YouTube audio'}.${extension}`;
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extension], 'Content-Length': stat.size,
        'X-Audio-Title': encodeURIComponent(title), 'X-Audio-Filename': encodeURIComponent(filename),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      });
      await pipeline(fs.createReadStream(realFile), res, { signal });
    } catch (error) {
      const failure = signal.aborted ? abortReason(signal) : error;
      if (!(failure instanceof HttpError)) logger.error('YouTube import failed:', failure.code || failure.name || 'Error');
      sendJson(res, failure instanceof HttpError ? failure.status : 502, {
        error: failure instanceof HttpError ? failure.message : 'YouTube could not provide this audio. Try another video or upload an audio file.',
      });
      if (res.headersSent && !res.writableEnded && !res.destroyed) res.destroy();
      req.resume();
    } finally {
      clearTimeout(timer);
      req.off('aborted', onDisconnect);
      res.off('close', onDisconnect);
      if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => logger.error('Audio temporary-file cleanup failed.'));
      controllers.delete(controller);
      activeJobs--;
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  const stop = () => {
    closing = true;
    for (const controller of controllers) controller.abort(new HttpError(503, 'Audio import is temporarily unavailable.'));
    server.close();
  };
  return { server, stop };
}

if (require.main === module) {
  const { server, stop } = createApp();
  server.listen(Number(process.env.PORT) || 8080, '0.0.0.0', () => console.log('YouTube audio backend is listening.'));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

module.exports = { createApp, validateYouTubeUrl, downloadAudio, downloadArgs, runProcess, HttpError, MAX_BYTES, MAX_DURATION };

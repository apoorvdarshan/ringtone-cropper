'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createApp, validateYouTubeUrl, downloadAudio, downloadArgs, runProcess, HttpError, MAX_BYTES } = require('./server');

const TOKEN = 'test-token-with-at-least-24-characters';
const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const AUDIO = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3, 255]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ringtone-backend-test-'));
  const app = createApp({ token: TOKEN, tempDir, logger: { error() {} }, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    app.stop();
    app.server.closeAllConnections();
    for (let tries = 0; tries < 30 && (await fs.readdir(tempDir)).length; tries++) await pause(10);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  return {
    ...app, base, tempDir,
    post(body = { url: VIDEO }, headers = {}) {
      return fetch(`${base}/api/youtube`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    },
  };
}

async function fakeDownload(url, { directory }) {
  assert.equal(url, VIDEO);
  const filename = path.join(directory, 'original.webm');
  await fs.writeFile(filename, AUDIO);
  return { filename, title: 'Original audio 🎵' };
}

async function expectClean(tempDir) {
  for (let tries = 0; tries < 50; tries++) {
    if (!(await fs.readdir(tempDir)).length) return;
    await pause(10);
  }
  assert.deepEqual(await fs.readdir(tempDir), []);
}

test('canonicalizes only supported public YouTube video URLs', () => {
  for (const url of [VIDEO, 'https://youtu.be/jNQXAC9IVRw?t=2', 'https://music.youtube.com/watch?v=jNQXAC9IVRw', 'https://m.youtube.com/shorts/jNQXAC9IVRw']) {
    assert.equal(validateYouTubeUrl(url), VIDEO);
  }
  for (const value of [null, 'http://127.0.0.1/video', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw',
    'file:///etc/passwd', 'https://user:pass@youtube.com/watch?v=jNQXAC9IVRw', 'https://youtube.com:8443/watch?v=jNQXAC9IVRw',
    'https://youtu.be/too-short', 'https://youtube.com/playlist?list=abc', `${VIDEO}&list=abc`,
    'https://youtube.com/watch?v=jNQXAC9IVRw/../../secret']) {
    assert.throws(() => validateYouTubeUrl(value), { status: 400 });
  }
});

test('requires a strong configured backend token and authenticates before downloading', async (t) => {
  assert.throws(() => createApp({ token: '' }), /BACKEND_TOKEN/);
  let calls = 0;
  const app = await fixture(t, { download: async (...args) => { calls++; return fakeDownload(...args); } });
  const health = await fetch(`${app.base}/health`);
  assert.deepEqual(await health.json(), { ok: true });
  for (const authorization of ['', 'Bearer wrong-token']) {
    const response = await app.post({ url: VIDEO }, { Authorization: authorization });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
  }
  assert.equal(calls, 0);
});

test('returns the original audio bytes with safe encoded metadata and removes temporary files', async (t) => {
  const app = await fixture(t, { download: fakeDownload });
  const response = await app.post({ url: 'https://youtu.be/jNQXAC9IVRw?t=2' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/webm');
  assert.equal(response.headers.get('content-length'), String(AUDIO.length));
  assert.equal(decodeURIComponent(response.headers.get('x-audio-title')), 'Original audio 🎵');
  assert.equal(decodeURIComponent(response.headers.get('x-audio-filename')), 'Original audio 🎵.webm');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), AUDIO);
  await expectClean(app.tempDir);
});

test('rejects malformed, oversized, and non-JSON requests without running a downloader', async (t) => {
  let calls = 0;
  const app = await fixture(t, { download: async () => { calls++; } });
  for (const [body, headers, expected] of [
    ['{invalid', {}, 400], [JSON.stringify({ url: 'x'.repeat(9000) }), {}, 413],
    [{ url: VIDEO }, { 'Content-Type': 'text/plain' }, 415], [{ url: 'https://example.com' }, {}, 400], [null, {}, 400],
  ]) {
    const response = await app.post(body, headers);
    assert.equal(response.status, expected);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(calls, 0);
});

test('bounds chunked request bodies and returns a JSON error', async (t) => {
  const app = await fixture(t, { download: fakeDownload });
  const result = await new Promise((resolve, reject) => {
    const request = http.request(`${app.base}/api/youtube`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
    request.write('{"url":"');
    request.write('x'.repeat(10_000));
    request.end('"}');
  });
  assert.equal(result.status, 413);
  assert.equal(typeof result.body.error, 'string');
});

test('caps jobs at two and keeps each request in its own directory', async (t) => {
  const directories = [];
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const app = await fixture(t, { download: async (url, options) => {
    directories.push(options.directory);
    await ready;
    return fakeDownload(url, options);
  } });
  const first = app.post();
  const second = app.post();
  for (let tries = 0; tries < 100 && directories.length < 2; tries++) await pause(5);
  assert.equal(directories.length, 2);
  assert.notEqual(directories[0], directories[1]);
  const busy = await app.post();
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get('retry-after'), '15');
  release();
  for (const response of await Promise.all([first, second])) {
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), AUDIO);
  }
  await expectClean(app.tempDir);
});

test('timeouts cancel work, return 504, and remove partial downloads', async (t) => {
  const app = await fixture(t, { jobTimeout: 50, download: async (url, { directory, signal }) => {
    await fs.writeFile(path.join(directory, 'partial.webm'), AUDIO);
    await new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  const response = await app.post();
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /too long/);
  await expectClean(app.tempDir);
});

test('disconnect cancels the downloader and cleans its directory', async (t) => {
  let started, canceled = false;
  const ready = new Promise((resolve) => { started = resolve; });
  const app = await fixture(t, { download: async (url, { directory, signal }) => {
    await fs.writeFile(path.join(directory, 'partial.webm'), AUDIO);
    started();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => { canceled = true; reject(signal.reason); }, { once: true }));
  } });
  const abort = new AbortController();
  const pending = fetch(`${app.base}/api/youtube`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ url: VIDEO }), signal: abort.signal,
  }).catch((error) => error);
  await ready;
  abort.abort();
  await pending;
  await expectClean(app.tempDir);
  assert.equal(canceled, true);
});

test('refuses oversized output and hides private downloader errors', async (t) => {
  const app = await fixture(t, { download: async (url, { directory }) => {
    const filename = path.join(directory, 'original.webm');
    const file = await fs.open(filename, 'w');
    await file.truncate(MAX_BYTES + 1);
    await file.close();
    return { filename, title: 'Large' };
  } });
  const oversized = await app.post();
  assert.equal(oversized.status, 413);
  await oversized.json();
  await expectClean(app.tempDir);

  const failing = await fixture(t, { download: async () => { throw new Error('private token and internal file paths'); } });
  const failure = await failing.post();
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /private|token|paths/);
  await expectClean(failing.tempDir);
});

test('yt-dlp selects the best audio stream without lossy re-encoding', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ringtone-download-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const args = downloadArgs(VIDEO, directory);
  assert.equal(args[args.indexOf('-f') + 1], 'bestaudio');
  assert.ok(args.includes('--js-runtimes'));
  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
  for (const lossyOption of ['--extract-audio', '-x', '--audio-format', '--recode-video']) assert.ok(!args.includes(lossyOption));
  const result = await downloadAudio(VIDEO, { directory, run: async (command, receivedArgs) => {
    assert.equal(command, 'yt-dlp');
    assert.deepEqual(receivedArgs, args);
    await fs.writeFile(path.join(directory, 'original.webm'), AUDIO);
    await fs.writeFile(path.join(directory, 'original.info.json'), JSON.stringify({ title: 'Original', duration: 19, is_live: false }));
  } });
  assert.deepEqual(await fs.readFile(result.filename), AUDIO);
  assert.equal(result.title, 'Original');
});

test('validates downloaded duration and rejects live streams', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ringtone-metadata-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const info of [{ duration: 1201 }, { duration: 30, is_live: true }, { duration: 30, live_status: 'is_upcoming' }, { duration: null }]) {
    await assert.rejects(downloadAudio(VIDEO, { directory, run: async () => {
      await fs.writeFile(path.join(directory, 'original.webm'), AUDIO);
      await fs.writeFile(path.join(directory, 'original.info.json'), JSON.stringify(info));
    } }), { status: 422 });
  }
});

test('child process failures and timeouts become safe public errors', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stderr.write("private details"); process.exit(1)']), { status: 422 });
  for (const message of ['Sign in to confirm you are not a bot', 'login required', 'Please confirm that you are not a bot']) {
    await assert.rejects(runProcess(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(message)}); process.exit(1)`]), {
      status: 422, message: 'YouTube is requiring sign-in for this video. Try another public video or upload a file.',
    });
  }
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 30 }), { status: 504 });
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  controller.abort(new HttpError(499, 'The request was canceled.'));
  await assert.rejects(pending, { status: 499 });
});

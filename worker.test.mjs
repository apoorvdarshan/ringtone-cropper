import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const base = 'https://ringtone.example';
const request = (body, headers = {}) => new Request(`${base}/api/youtube`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body),
});
const environment = () => ({
  ASSETS: { fetch: () => new Response('editor') },
  YOUTUBE_BACKEND_URL: 'https://backend.example', BACKEND_TOKEN: 'test-secret',
  IMPORT_RATE_LIMITER: { limit: async () => ({ success: true }) },
});

test('keeps static assets available and rejects unknown API routes', async () => {
  assert.equal(await (await worker.fetch(new Request(base), environment())).text(), 'editor');
  assert.equal((await worker.fetch(new Request(`${base}/api/unknown`), environment())).status, 404);
  assert.equal((await worker.fetch(new Request(`${base}/api/youtube`), environment())).status, 405);
});

test('rejects cross-site imports, invalid targets, and excessive bodies before contacting the backend', async () => {
  const env = environment();
  assert.equal((await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw' }, { Origin: 'https://other.example' }), env)).status, 403);
  assert.equal((await worker.fetch(request({ url: 'https://youtube.com.evil.example/watch?v=jNQXAC9IVRw' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ url: 'https://youtube.com/playlist?list=PL123' }), env)).status, 400);
  assert.equal((await worker.fetch(request({ url: 'x'.repeat(9000) }), env)).status, 413);
});

test('rate-limited imports return a retry interval', async () => {
  const env = environment();
  env.IMPORT_RATE_LIMITER.limit = async () => ({ success: false });
  const response = await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw' }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});

test('proxies original audio bytes and keeps backend credentials private', async t => {
  const audio = new Uint8Array([0, 1, 255, 128, 47]);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://backend.example/api/youtube');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.deepEqual(JSON.parse(options.body), { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
    return new Response(audio, { headers: { 'Content-Type': 'audio/webm', 'X-Audio-Filename': 'Test.webm', 'X-Audio-Title': 'Test', 'X-Private-Debug': 'secret' } });
  });
  const response = await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw?si=ignored' }), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
  assert.equal(response.headers.get('x-audio-filename'), 'Test.webm');
  assert.equal(response.headers.has('x-private-debug'), false);
  assert.equal(response.headers.has('authorization'), false);
});

test('turns backend errors into actionable JSON and hides unexpected server errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'This video needs sign-in. Try a public video.' }, { status: 422 }));
  const response = await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw' }), environment());
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /public video/);
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ error: 'private internal failure' }, { status: 500 }));
  const failure = await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw' }), environment());
  assert.equal(failure.status, 502);
  assert.doesNotMatch((await failure.json()).error, /private internal/);
});

test('uses the bound container with canonical input and preserves original bytes without exposing its credentials', async t => {
  const audio = new Uint8Array([255, 0, 128, 42]);
  const env = environment();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('The external backend must not be used when a container is bound.'); });
  let calls = 0;
  env.YOUTUBE_CONTAINER = {
    getByName(name) {
      assert.equal(name, 'youtube-audio');
      return { async fetch(forwarded) {
        calls++;
        assert.equal(forwarded.url, 'http://container/api/youtube');
        assert.equal(forwarded.method, 'POST');
        assert.equal(forwarded.headers.get('authorization'), 'Bearer test-secret');
        assert.equal(forwarded.headers.get('cookie'), null);
        assert.deepEqual(await forwarded.json(), { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
        return new Response(audio, { headers: {
          'Content-Type': 'audio/webm', 'Content-Length': String(audio.length),
          'X-Audio-Title': 'Original', 'X-Audio-Filename': 'Original.webm',
          Authorization: 'Bearer private-backend-secret',
        } });
      } };
    },
  };
  const response = await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw?t=2' }, { Cookie: 'private-browser-cookie' }), env);
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(response.headers.get('x-audio-filename'), 'Original.webm');
  assert.equal(response.headers.has('authorization'), false);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audio);
});

test('container requests honor client cancellation', async () => {
  const env = environment();
  delete env.YOUTUBE_BACKEND_URL;
  const controller = new AbortController();
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let forwardedSignal;
  env.YOUTUBE_CONTAINER = {
    getByName() {
      return { fetch(forwarded) {
        forwardedSignal = forwarded.signal;
        entered();
        return new Promise((resolve, reject) => {
          forwarded.signal.addEventListener('abort', () => reject(forwarded.signal.reason), { once: true });
        });
      } };
    },
  };
  const input = new Request(request({ url: 'https://youtu.be/jNQXAC9IVRw' }), { signal: controller.signal });
  const pending = worker.fetch(input, env);
  await ready;
  controller.abort();
  assert.equal((await pending).status, 504);
  assert.equal(forwardedSignal.aborted, true);
});

test('rate limits are checked before starting the container', async () => {
  const env = environment();
  env.IMPORT_RATE_LIMITER.limit = async () => ({ success: false });
  env.YOUTUBE_CONTAINER = { getByName() { assert.fail('Rate-limited requests must not start a container.'); } };
  assert.equal((await worker.fetch(request({ url: 'https://youtu.be/jNQXAC9IVRw' }), env)).status, 429);
});

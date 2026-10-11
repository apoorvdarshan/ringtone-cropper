const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createApp, parseRange, validateYouTubeUrl } = require('./server');
const run = promisify(execFile);
let server, address, directory, audio;

before(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ringtone-test-'));
  const fixture = path.join(directory, 'fixture.wav');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s24le', fixture]);
  audio = await fsp.readFile(fixture);
  server = createApp({ legacySource: null, downloadDir: path.join(directory, 'Downloads'), tempDir: directory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (directory) await fsp.rm(directory, { recursive: true, force: true });
});

async function upload(filename = 'Test song.wav', bytes = audio) {
  const response = await fetch(`${address}/api/upload`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Filename': encodeURIComponent(filename) }, body: bytes });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

test('starts without the old hard-coded song', async () => {
  const response = await fetch(`${address}/api/source`);
  assert.deepEqual(await response.json(), { source: null });
  const missing = await fetch(`${address}/audio`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /choose/i);
});

test('accepts only canonical public YouTube video targets', () => {
  for (const url of ['https://youtu.be/jNQXAC9IVRw?t=3', 'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=bad', 'https://youtube.com/shorts/jNQXAC9IVRw']) {
    assert.equal(validateYouTubeUrl(url), 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  }
  for (const url of ['file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://youtube.com@127.0.0.1/watch?v=jNQXAC9IVRw', 'https://youtube.com/playlist?list=123', 'http://localhost:3005', '--help']) {
    assert.throws(() => validateYouTubeUrl(url));
  }
});

test('validates byte ranges including suffix and open-ended ranges', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=90-200', 100), { start: 90, end: 99 });
  for (const range of ['bytes=100-', 'bytes=5-4', 'bytes=-0', 'bytes=-', 'bytes=1-2,3-4', 'bytes=NaN-', 'bytes=9007199254740993-']) assert.equal(parseRange(range, 100), null);
});

test('imports audio losslessly and keeps immutable source IDs across imports', async () => {
  const first = await upload('../Test song.wav');
  assert.equal(first.title, 'Test song');
  assert.equal(first.sourceKind, 'upload');
  assert.equal(first.duration, 2);
  assert.match(first.quality, /48 kHz/);
  const second = await upload('Replacement.wav');
  assert.notEqual(first.id, second.id);
  const selected = await (await fetch(`${address}/api/source`)).json();
  assert.equal(selected.source.id, second.id);
  const range = await fetch(`${address}${first.audioUrl}`, { headers: { Range: 'bytes=0-31' } });
  assert.equal(range.status, 206);
  const header = Buffer.from(await range.arrayBuffer());
  assert.equal(header.length, 32);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  const invalid = await fetch(`${address}${first.audioUrl}`, { headers: { Range: 'bytes=999999999-' } });
  assert.equal(invalid.status, 416);
  const preview = path.join(directory, 'preview.wav');
  const all = await fetch(`${address}${first.audioUrl}`);
  await fsp.writeFile(preview, Buffer.from(await all.arrayBuffer()));
  const metadata = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', preview])).stdout).streams[0];
  assert.equal(metadata.codec_name, 'pcm_f32le');
  assert.equal(metadata.sample_rate, '48000');
  assert.equal(metadata.channels, 1);
});

test('rejects malformed uploads and unsafe requests without replacing the selected source', async () => {
  const selected = await (await fetch(`${address}/api/source`)).json();
  const invalid = await fetch(`${address}/api/upload`, { method: 'POST', body: 'not audio' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /audio/i);
  const crossOrigin = await fetch(`${address}/api/upload`, { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: audio });
  assert.equal(crossOrigin.status, 403);
  const invalidYoutube = await fetch(`${address}/api/youtube`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://localhost/private' }) });
  assert.equal(invalidYoutube.status, 400);
  assert.deepEqual(await (await fetch(`${address}/api/source`)).json(), selected);
});

test('exports high-quality clips in all formats with unique saved filenames', async () => {
  const source = await upload('Export test.wav');
  const savedNames = [];
  for (const format of ['wav', 'm4r', 'mp3', 'wav']) {
    const response = await fetch(`${address}/export?id=${source.id}&start=0.25&dur=1.25&fade=1&fmt=${format}`);
    assert.equal(response.status, 200, await response.clone().text());
    const savedPath = decodeURIComponent(response.headers.get('X-Saved-Path'));
    savedNames.push(savedPath);
    assert.equal(path.dirname(savedPath), path.join(directory, 'Downloads'));
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(await fsp.readFile(savedPath), downloaded);
    const metadata = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,bit_rate', '-of', 'json', savedPath])).stdout);
    assert.equal(metadata.streams[0].codec_name, { wav: 'pcm_f32le', mp3: 'mp3', m4r: 'aac' }[format]);
    assert.equal(metadata.streams[0].sample_rate, '48000');
    if (format === 'mp3') assert.equal(metadata.streams[0].bit_rate, '320000');
    assert.ok(Math.abs(Number(metadata.format.duration) - 1.25) < 0.1);
  }
  assert.equal(new Set(savedNames).size, savedNames.length);
  const badTime = await fetch(`${address}/export?id=${source.id}&start=NaN&dur=1&fmt=wav`);
  assert.equal(badTime.status, 400);
  const badFormat = await fetch(`${address}/export?id=${source.id}&start=0&dur=1&fmt=exe`);
  assert.equal(badFormat.status, 400);
});

test('lossless WAV crops retain decoded samples and fades alter only the requested edges', async () => {
  const source = await upload('Sample accuracy.wav');
  async function exportSamples(fade) {
    const response = await fetch(`${address}/export?id=${source.id}&start=0.25&dur=1.25&fade=${fade}&fmt=wav`);
    assert.equal(response.status, 200);
    const filename = decodeURIComponent(response.headers.get('X-Saved-Path'));
    await response.arrayBuffer();
    return (await run('ffmpeg', ['-v', 'error', '-i', filename, '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'], { encoding: 'buffer' })).stdout;
  }
  const original = (await run('ffmpeg', ['-v', 'error', '-i', path.join(directory, 'fixture.wav'), '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'], { encoding: 'buffer' })).stdout;
  const plain = await exportSamples(0);
  const faded = await exportSamples(1);
  assert.equal(plain.length, 1.25 * 48000 * 4);
  assert.deepEqual(plain, original.subarray(0.25 * 48000 * 4, 1.5 * 48000 * 4));
  const early = Math.round(0.125 * 48000) + 17;
  const middle = Math.round(0.55 * 48000) + 17;
  const late = Math.round(1.125 * 48000) + 17;
  assert.ok(Math.abs(faded.readFloatLE(early * 4)) < Math.abs(plain.readFloatLE(early * 4)) * 0.3);
  assert.equal(faded.readFloatLE(middle * 4), plain.readFloatLE(middle * 4));
  assert.ok(Math.abs(faded.readFloatLE(late * 4)) < Math.abs(plain.readFloatLE(late * 4)) * 0.25);
});

test('low-rate sources still export MP3 at 320 kb/s while WAV retains the original rate', async () => {
  for (const sampleRate of [8000, 16000, 22050, 24000]) {
    const fixture = path.join(directory, `low-rate-${sampleRate}.wav`);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=sample_rate=${sampleRate}:duration=1`, fixture]);
    const source = await upload(`${sampleRate}.wav`, await fsp.readFile(fixture));
    for (const format of ['mp3', 'wav']) {
      const response = await fetch(`${address}/export?id=${source.id}&start=0&dur=1&fmt=${format}`);
      assert.equal(response.status, 200);
      const savedPath = decodeURIComponent(response.headers.get('X-Saved-Path'));
      await response.arrayBuffer();
      const metadata = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,bit_rate', '-of', 'json', savedPath])).stdout).streams[0];
      if (format === 'mp3') {
        assert.equal(metadata.bit_rate, '320000');
        assert.equal(metadata.sample_rate, sampleRate === 22050 ? '44100' : '48000');
      } else assert.equal(metadata.sample_rate, String(sampleRate));
    }
  }
});

const MAX_BODY = 8192;

function error(message, status, headers = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function youtubeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname)) return null;
  const id = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1)
    : url.pathname === '/watch' ? url.searchParams.get('v')
      : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('too-large');
  if (!request.body) throw new Error('invalid');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error('too-large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname !== '/api/youtube') return error('Not found.', 404);
    if (request.method !== 'POST') return error('Use POST to import a YouTube video.', 405, { Allow: 'POST' });
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return error('Import audio using the form on this site.', 403);
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return error('Send a YouTube video link as JSON.', 415);
    }
    let body;
    try { body = await readBody(request); }
    catch (cause) { return error(cause.message === 'too-large' ? 'The request is too large.' : 'Enter a valid YouTube video link.', cause.message === 'too-large' ? 413 : 400); }
    const target = youtubeUrl(body?.url);
    if (!target) return error('Use a link to one public YouTube video.', 400);
    if ((!env.YOUTUBE_CONTAINER && !env.YOUTUBE_BACKEND_URL) || !env.BACKEND_TOKEN) return error('YouTube import is temporarily unavailable. You can still upload a file.', 503);
    const allowance = await env.IMPORT_RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    if (!allowance.success) return error('Too many imports. Wait a minute and try again.', 429, { 'Retry-After': '60' });

    try {
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.BACKEND_TOKEN}` },
        body: JSON.stringify({ url: target }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(250_000)]),
        redirect: 'manual',
      };
      const backend = env.YOUTUBE_CONTAINER
        ? await env.YOUTUBE_CONTAINER.getByName('youtube-audio').fetch(new Request('http://container/api/youtube', options))
        : await fetch(new URL('/api/youtube', env.YOUTUBE_BACKEND_URL), options);
      if (!backend.ok) {
        const data = await backend.json().catch(() => ({}));
        const status = [400, 413, 422, 429, 503, 504].includes(backend.status) ? backend.status : 502;
        return error((status !== 502 && data.error) || 'YouTube audio could not be downloaded. Try another video or upload a file.', status,
          backend.headers.has('retry-after') ? { 'Retry-After': backend.headers.get('retry-after') } : {});
      }
      const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for (const name of ['Content-Type', 'Content-Length', 'X-Audio-Title', 'X-Audio-Filename']) {
        if (backend.headers.has(name)) headers.set(name, backend.headers.get(name));
      }
      return new Response(backend.body, { status: 200, headers });
    } catch (cause) {
      console.error('YouTube gateway failed:', String(cause?.message || cause).replaceAll(env.BACKEND_TOKEN, '[redacted]'));
      return error('YouTube import timed out or is unavailable. Try a shorter video or upload a file.', 504);
    }
  },
};

export { youtubeUrl };

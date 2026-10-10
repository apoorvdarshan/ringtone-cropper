import { FFmpeg } from "/vendor/ffmpeg/index.js";
import { fetchFile } from "/vendor/util/index.js";

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const CORE_WASM_BYTES = 32.1e6; // uncompressed ffmpeg-core.wasm, for the download progress label
const MIN_LEN = 1, MAX_LEN = 40;
const $ = (id) => document.getElementById(id);

const stage = $("stage"), track = $("track"), canvas = $("wave"), sel = $("sel"), head = $("head");
const playBtn = $("play"), loopBtn = $("loop"), editor = $("editor");
const statusEl = $("status"), progressEl = $("progress"), busyEl = $("busy");
const presetButtons = [...document.querySelectorAll("#presets button")];
const exportButtons = [...document.querySelectorAll(".dl")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

let file = null, fsName = null, fileCount = 0, buffer = null, duration = 0;
let clipStart = 0, clipLen = 29.9;
let peaks = null, ghostPeaks = null, grow = 1;
let actx = null, source = null, playStartedAt = 0, playFrom = 0, playPos = null, raf = 0, loop = false;
let ffmpeg = null, ffmpegLoading = null, onEncoderBytes = null, onEncoderLog = null, exporting = false;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const round1 = (v) => Math.round(v * 10) / 10;
const fmt = (s) => { s = round1(s); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`; };
const fmtShort = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ext = (name) => (name.match(/\.[a-z0-9]+$/i)?.[0] || ".bin").toLowerCase();
const baseName = (name) => name.replace(/\.[^.]+$/, "");
// "Artist – Song [Official Music Video] (4K Remaster)" → "Artist – Song", for the ringtone's name on the phone.
const toneName = (name) => {
  const tidy = baseName(name)
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\((?:[^)]*\b(?:official|video|audio|lyrics?|visuali[sz]er|remaster(?:ed)?|hd|4k|mv)\b[^)]*)\)/gi, "")
    .replace(/\s{2,}/g, " ").trim();
  return (tidy || baseName(name)).slice(0, 60);
};

// ---------- ffmpeg (lazy) ----------
async function fetchBlobURL(url, type, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the encoder (HTTP ${res.status}). Check your connection and try again.`);
  if (!onBytes || !res.body) return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
  const reader = res.body.getReader(), chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onBytes(received);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

function loadFFmpeg() {
  if (ffmpegLoading) return ffmpegLoading;
  ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => onEncoderLog?.(message));
  ffmpegLoading = (async () => {
    await ffmpeg.load({
      coreURL: await fetchBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await fetchBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm", (n) => onEncoderBytes?.(n)),
    });
    return ffmpeg;
  })().catch((e) => { ffmpegLoading = null; throw e; });
  return ffmpegLoading;
}

// Each opened file gets its own name in ffmpeg's filesystem, so a new song never reuses the old one's data.
async function ensureInput(ff) {
  if (!(await ff.listDir("/")).some((n) => n.name === fsName)) await ff.writeFile(fsName, await fetchFile(file));
}

// ---------- opening a file ----------
async function openFile(f) {
  if (!f || exporting) return;
  stop();
  if (ffmpeg?.loaded && fsName) ffmpeg.deleteFile(fsName).catch(() => {});
  file = f;
  fsName = `src${++fileCount}${ext(f.name)}`;
  buffer = null; duration = 0; peaks = null;
  sel.hidden = true;
  setStatus("");
  showBusy(`Reading “${f.name}”…`);
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    buffer = await actx.decodeAudioData(await f.arrayBuffer());
  } catch {
    // The browser can't decode this one (some video containers): convert it with ffmpeg first.
    showBusy("Converting this file. The first time, that means downloading a 32 MB encoder…");
    const ff = await loadFFmpeg();
    await ensureInput(ff);
    await ff.exec(["-i", fsName, "-vn", "-ac", "2", "-ar", "44100", "decoded.wav"]);
    const data = await ff.readFile("decoded.wav");
    await ff.deleteFile("decoded.wav");
    buffer = await actx.decodeAudioData(data.buffer);
  }
  duration = buffer.duration;
  clipLen = clamp(clipLen, Math.min(MIN_LEN, duration), Math.min(MAX_LEN, duration));
  clipStart = loudestStart(clipLen);

  $("fname").textContent = f.name;
  $("toneName").textContent = `${toneName(f.name)} (ringtone)`;
  $("total").textContent = fmtShort(duration);
  stage.classList.remove("is-empty");
  editor.classList.remove("is-locked");
  $("swap").hidden = false;
  sel.hidden = false;
  document.querySelectorAll("#transport button, .dl").forEach((b) => (b.disabled = false));
  busyEl.hidden = true;

  computePeaks();
  update();
  growIn();
  loadFFmpeg().catch(() => {}); // warm up the encoder for saving
}

function showBusy(msg) {
  busyEl.textContent = msg;
  busyEl.hidden = false;
}

function openFailed(e) {
  console.error(e);
  busyEl.hidden = true;
  if (!buffer) {
    file = null;
    $("fname").textContent = "No song chosen";
    stage.classList.add("is-empty");
    editor.classList.add("is-locked");
    $("swap").hidden = true;
    sel.hidden = true;
    draw();
  }
  setStatus("That file couldn’t be opened. Try an mp3, m4a, wav or a video with sound.", "err");
  stage.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

const fileEl = $("file");
fileEl.onchange = () => { const f = fileEl.files[0]; fileEl.value = ""; if (f) openFile(f).catch(openFailed); };
$("drop").onclick = () => fileEl.click();
$("swap").onclick = () => fileEl.click();
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; stage.classList.add("over"); });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove("over"); } });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) openFile(f).catch(openFailed);
});

// Starting point: the loudest stretch of the clip's length, which is usually the chorus.
function loudestStart(len) {
  const data = buffer.getChannelData(0), rate = buffer.sampleRate;
  const secs = Math.floor(duration);
  if (secs <= len + 1) return 0;
  const energy = new Float64Array(secs);
  for (let s = 0; s < secs; s++) {
    let sum = 0;
    for (let i = s * rate, end = Math.min((s + 1) * rate, data.length); i < end; i += 32) sum += data[i] * data[i];
    energy[s] = sum;
  }
  const win = Math.round(len);
  let cur = 0;
  for (let s = 0; s < win; s++) cur += energy[s];
  let best = cur, bestAt = 0;
  for (let s = win; s < secs; s++) {
    cur += energy[s] - energy[s - win];
    if (cur > best) { best = cur; bestAt = s - win + 1; }
  }
  return clamp(bestAt, 0, Math.max(0, duration - len));
}

// ---------- waveform ----------
const BAR_STEP = 5; // CSS px per bar, including the gap
let colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["bar", "bar-off", "bar-ghost", "trim"]) colors[k] = cs.getPropertyValue(`--${k}`).trim();
}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); draw(); });

function barCount() { return Math.max(40, Math.floor(track.clientWidth / BAR_STEP)); }

function computePeaks() {
  const n = barCount();
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const step = Math.max(1, Math.floor(ch0.length / n));
  peaks = new Float32Array(n);
  let top = 0;
  for (let x = 0; x < n; x++) {
    let max = 0;
    for (let i = x * step, end = Math.min(i + step, ch0.length); i < end; i += 16) {
      const v = Math.max(Math.abs(ch0[i]), Math.abs(ch1[i]));
      if (v > max) max = v;
    }
    peaks[x] = max;
    if (max > top) top = max;
  }
  for (let x = 0; x < n; x++) peaks[x] = Math.pow(peaks[x] / (top || 1), 0.8);
}

// A made-up waveform for the empty state, so the editor reads as an editor before a song is chosen.
function computeGhost() {
  const n = barCount();
  ghostPeaks = new Float32Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < n; x++) {
    const t = x / n;
    const shape = 0.35 + 0.4 * Math.sin(t * Math.PI) + 0.2 * Math.sin(t * 19);
    ghostPeaks[x] = clamp(shape * (0.55 + 0.45 * rand()), 0.06, 1);
  }
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = track.clientWidth, h = track.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const data = peaks || ghostPeaks;
  if (!data) return;
  const n = data.length, step = w / n, bw = Math.max(1.5, step * 0.58);
  const a = duration ? (clipStart / duration) * w : -1;
  const b = duration ? ((clipStart + clipLen) / duration) * w : -1;
  const played = playPos != null && duration ? (playPos / duration) * w : -1;

  for (let i = 0; i < n; i++) {
    const x = i * step + (step - bw) / 2, cx = x + bw / 2;
    let g = 1;
    if (grow < 1) g = clamp(grow * 1.6 - (i / n) * 0.6, 0, 1), g = 1 - Math.pow(1 - g, 3);
    const bh = Math.max(2, data[i] * h * 0.86 * g);
    if (!peaks) { ctx.fillStyle = colors["bar-ghost"]; ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, Math.abs(i / n - 0.5) * 3); }
    else if (cx >= a && cx <= b) ctx.fillStyle = cx <= played ? colors.trim : colors.bar;
    else ctx.fillStyle = colors["bar-off"];
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, (h - bh) / 2, bw, bh, bw / 2);
    else ctx.rect(x, (h - bh) / 2, bw, bh);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function growIn() {
  if (reduceMotion.matches) { grow = 1; draw(); return; }
  const t0 = performance.now();
  const frame = (t) => {
    grow = Math.min(1, (t - t0) / 700);
    draw();
    if (grow < 1) requestAnimationFrame(frame);
  };
  grow = 0;
  requestAnimationFrame(frame);
}

let resizeTimer = 0;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (buffer) computePeaks(); else computeGhost(); draw(); }, 60);
}).observe(track);
computeGhost();
draw();

// ---------- selection ----------
function update() {
  if (!duration) return;
  clipLen = round1(clamp(clipLen, Math.min(MIN_LEN, duration), Math.min(MAX_LEN, duration)));
  clipStart = round1(clamp(clipStart, 0, Math.max(0, duration - clipLen)));
  sel.style.left = (clipStart / duration) * 100 + "%";
  sel.style.width = (clipLen / duration) * 100 + "%";
  $("range").textContent = `${fmt(clipStart)} – ${fmt(clipStart + clipLen)}`;
  $("meta").textContent = `${clipLen.toFixed(1)} seconds of a ${fmtShort(duration)} song`;
  sel.setAttribute("aria-valuemax", Math.max(0, duration - clipLen).toFixed(1));
  sel.setAttribute("aria-valuenow", clipStart.toFixed(1));
  sel.setAttribute("aria-valuetext", `Starts at ${fmt(clipStart)}, ${clipLen.toFixed(1)} seconds long`);
  presetButtons.forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(parseFloat(b.dataset.d) - clipLen) < 0.05)));
  draw();
}

function moveBy(delta) {
  clipStart += delta;
  update();
  if (source) play();
}

presetButtons.forEach((b) => (b.onclick = () => {
  const end = clipStart + clipLen;
  clipLen = parseFloat(b.dataset.d);
  // Keep the clip inside the song: if it would run off the end, slide it back.
  if (clipStart + clipLen > duration) clipStart = Math.max(0, Math.min(clipStart, end - clipLen));
  update();
  if (source) play();
}));
document.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => moveBy(parseFloat(b.dataset.n))));

// Drag the frame to move it, drag a handle to resize it, or tap elsewhere to center it there.
let drag = null;
const timeAt = (clientX) => {
  const r = track.getBoundingClientRect();
  return clamp((clientX - r.left) / r.width, 0, 1) * duration;
};
track.addEventListener("pointerdown", (e) => {
  if (!duration || e.button > 0) return;
  const t = timeAt(e.clientX);
  const grip = e.target.closest(".grip")?.dataset.grip;
  if (grip) drag = { mode: grip, end: clipStart + clipLen };
  else if (t >= clipStart && t <= clipStart + clipLen) drag = { mode: "move", offset: t - clipStart };
  else { drag = { mode: "move", offset: clipLen / 2 }; clipStart = t - clipLen / 2; update(); }
  try { track.setPointerCapture(e.pointerId); } catch {}
  stage.classList.add("dragging");
  sel.focus({ preventScroll: true });
  e.preventDefault();
});
track.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const t = timeAt(e.clientX);
  if (drag.mode === "move") clipStart = t - drag.offset;
  else if (drag.mode === "l") {
    clipStart = clamp(t, drag.end - MAX_LEN, drag.end - MIN_LEN);
    clipLen = drag.end - clipStart;
  } else clipLen = clamp(t - clipStart, MIN_LEN, Math.min(MAX_LEN, duration - clipStart));
  update();
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  stage.classList.remove("dragging");
  if (source) play();
};
track.addEventListener("pointerup", endDrag);
track.addEventListener("pointercancel", endDrag);

document.addEventListener("keydown", (e) => {
  if (!buffer || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest("input, button, a, label, select, textarea")) return;
  if (e.code === "Space") { e.preventDefault(); source ? stop() : play(); }
  else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    moveBy((e.code === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
  } else if (e.code === "Home" && e.target === sel) { e.preventDefault(); clipStart = 0; update(); }
  else if (e.code === "End" && e.target === sel) { e.preventDefault(); clipStart = duration; update(); }
});

// ---------- preview ----------
function play() {
  stop(true);
  actx.resume();
  const len = clipLen, now = actx.currentTime;
  const gain = actx.createGain();
  const fi = $("fadeIn").checked ? Math.min(0.5, len / 4) : 0;
  const fo = $("fadeOut").checked ? Math.min(1.5, len / 4) : 0;
  gain.gain.setValueAtTime(fi ? 0 : 1, now);
  if (fi) gain.gain.linearRampToValueAtTime(1, now + fi);
  if (fo) { gain.gain.setValueAtTime(1, now + len - fo); gain.gain.linearRampToValueAtTime(0, now + len); }
  source = actx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(actx.destination);
  source.start(now, clipStart, len);
  playStartedAt = now;
  playFrom = clipStart;
  source.onended = () => (loop && source ? play() : stop());
  playBtn.classList.add("playing");
  playBtn.setAttribute("aria-label", "Stop");
  head.hidden = false;
  const tick = () => {
    playPos = playFrom + (actx.currentTime - playStartedAt);
    head.style.left = (playPos / duration) * 100 + "%";
    draw();
    raf = requestAnimationFrame(tick);
  };
  tick();
}
function stop(keepUi) {
  if (source) { source.onended = null; try { source.stop(); } catch {} source = null; }
  cancelAnimationFrame(raf);
  if (keepUi) return;
  playPos = null;
  playBtn.classList.remove("playing");
  playBtn.setAttribute("aria-label", "Play clip");
  head.hidden = true;
  draw();
}
playBtn.onclick = () => (source ? stop() : play());
loopBtn.onclick = () => { loop = !loop; loopBtn.setAttribute("aria-pressed", String(loop)); };
for (const id of ["fadeIn", "fadeOut"]) $(id).addEventListener("change", () => source && play());

// ---------- saving ----------
const FORMATS = {
  m4r: { args: ["-c:a", "aac", "-b:a", "256k", "-f", "ipod"], mime: "audio/x-m4r" },
  m4a: { args: ["-c:a", "aac", "-b:a", "256k", "-f", "ipod"], mime: "audio/mp4" },
  mp3: { args: ["-c:a", "libmp3lame", "-q:a", "0"], mime: "audio/mpeg" },
  wav: { args: ["-c:a", "pcm_s16le"], mime: "audio/wav" },
};

async function exportAs(key, btn) {
  if (!file || exporting) return;
  exporting = true;
  exportButtons.forEach((b) => (b.disabled = true));
  btn.setAttribute("aria-busy", "true");
  const label = btn.querySelector(".lbl") || btn, original = label.textContent;
  label.textContent = "Saving…";
  setProgress(0);
  try {
    if (!ffmpeg?.loaded) {
      setStatus("Loading the encoder. It’s about 32 MB and only downloads once…");
      onEncoderBytes = (n) => {
        setStatus(`Loading the encoder: ${Math.min(32, Math.round(n / 1e6))} of about 32 MB`);
        setProgress(Math.min(n / CORE_WASM_BYTES, 0.99));
      };
    }
    const ff = await loadFFmpeg();
    onEncoderBytes = null;
    setStatus("Encoding…");
    setProgress(0);
    await ensureInput(ff);

    const len = clipLen, start = clipStart;
    const filters = [];
    if ($("norm").checked) filters.push("loudnorm=I=-14:TP=-1:LRA=11");
    if ($("fadeIn").checked) filters.push(`afade=t=in:st=0:d=${Math.min(0.5, len / 4)}`);
    if ($("fadeOut").checked) { const d = Math.min(1.5, len / 4); filters.push(`afade=t=out:st=${(len - d).toFixed(2)}:d=${d}`); }

    onEncoderLog = (msg) => {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(msg);
      if (!m) return;
      const p = clamp((+m[1] * 3600 + +m[2] * 60 + +m[3]) / len, 0, 1);
      setProgress(p);
      setStatus(`Encoding ${Math.round(p * 100)}%`);
    };
    const out = "out." + key;
    const args = ["-y", "-ss", start.toFixed(2), "-t", len.toFixed(2), "-i", fsName, "-vn", "-map_metadata", "-1", "-ac", "2", "-ar", "44100"];
    if (filters.length) args.push("-af", filters.join(","));
    args.push(...FORMATS[key].args, out);

    const code = await ff.exec(args);
    if (code !== 0) throw new Error("the encoder stopped with code " + code);
    const data = await ff.readFile(out);
    await ff.deleteFile(out);

    const blob = new Blob([data.buffer], { type: FORMATS[key].mime });
    const name = `${toneName(file.name)} (ringtone).${key}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);

    setProgress(1);
    const size = blob.size > 1e6 ? `${(blob.size / 1e6).toFixed(1)} MB` : `${Math.round(blob.size / 1e3)} KB`;
    setStatus(`Saved “${name}” (${size}).`, "ok");
    const next = document.createElement("a");
    next.href = "#install";
    next.textContent = "Add it to your iPhone";
    statusEl.append(" ", next);
  } catch (e) {
    console.error(e);
    setStatus(`Couldn’t save: ${e?.message || e}. Try again, or pick a different format.`, "err");
  } finally {
    onEncoderBytes = onEncoderLog = null;
    exporting = false;
    label.textContent = original;
    btn.removeAttribute("aria-busy");
    exportButtons.forEach((b) => (b.disabled = false));
    setTimeout(() => { if (!exporting) progressEl.hidden = true; }, 1200);
  }
}
exportButtons.forEach((b) => (b.onclick = () => exportAs(b.dataset.f, b)));

function setStatus(msg, cls = "") { statusEl.textContent = msg; statusEl.className = "status " + cls; }
function setProgress(p) { progressEl.hidden = false; progressEl.firstElementChild.style.width = p * 100 + "%"; }

// ---------- install guide tabs ----------
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.onclick = () => selectTab(t);
  t.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    selectTab(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
  };
});
// Open the guide on the tab that matches this device.
const ua = navigator.userAgent;
if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) selectTab($("tab-ios"));
else if (/Windows/.test(ua)) selectTab($("tab-win"));

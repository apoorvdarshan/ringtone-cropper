import { FFmpeg } from "/vendor/ffmpeg/index.js";
import { fetchFile, toBlobURL } from "/vendor/util/index.js";

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const $ = (id) => document.getElementById(id);

const drop = $("drop"), fileEl = $("file"), editor = $("editor");
const startEl = $("start"), durEl = $("dur"), info = $("info"), status = $("status");
const wrap = $("wrap"), sel = $("sel"), head = $("head"), canvas = $("wave");
const playBtn = $("play"), loopBtn = $("loop");

let file = null, buffer = null, duration = 0;
let actx = null, source = null, playStartedAt = 0, playOffset = 0, raf = 0, loop = false;
let ffmpeg = null, ffmpegLoading = null;

// ---------- ffmpeg (lazy) ----------
function loadFFmpeg() {
  if (ffmpegLoading) return ffmpegLoading;
  ffmpeg = new FFmpeg();
  ffmpegLoading = (async () => {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return ffmpeg;
  })().catch((e) => { ffmpegLoading = null; throw e; });
  return ffmpegLoading;
}

// ---------- file loading ----------
const ext = (name) => (name.match(/\.[a-z0-9]+$/i)?.[0] || ".bin").toLowerCase();
const baseName = (name) => name.replace(/\.[^.]+$/, "");

async function openFile(f) {
  stop();
  file = f;
  $("fname").textContent = f.name;
  setStatus("Decoding audio…");
  editor.hidden = false;
  drop.classList.add("compact");
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    buffer = await actx.decodeAudioData(await f.arrayBuffer());
  } catch {
    // Browser can't decode it (e.g. some video containers) — convert with ffmpeg first.
    setStatus("Converting with ffmpeg (first time downloads ~30 MB engine)…");
    const ff = await loadFFmpeg();
    const inName = "src" + ext(f.name);
    await ff.writeFile(inName, await fetchFile(f));
    await ff.exec(["-i", inName, "-vn", "-ac", "2", "-ar", "44100", "decoded.wav"]);
    const data = await ff.readFile("decoded.wav");
    buffer = await actx.decodeAudioData(data.buffer);
  }
  duration = buffer.duration;
  startEl.value = 0;
  drawWave();
  update();
  setStatus("");
  loadFFmpeg().catch(() => {}); // warm up for export
}

fileEl.onchange = () => fileEl.files[0] && openFile(fileEl.files[0]).catch(fail);
["dragenter", "dragover"].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
window.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) openFile(f).catch(fail); });

// ---------- waveform ----------
function drawWave() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const step = Math.max(1, Math.floor(ch0.length / canvas.width));
  const peaks = new Float32Array(canvas.width);
  let top = 0;
  for (let x = 0; x < canvas.width; x++) {
    let max = 0;
    for (let i = x * step, end = i + step; i < end; i += 8) {
      const v = Math.max(Math.abs(ch0[i] || 0), Math.abs(ch1[i] || 0));
      if (v > max) max = v;
    }
    peaks[x] = max;
    if (max > top) top = max;
  }
  ctx.fillStyle = "#6e6e78";
  for (let x = 0; x < canvas.width; x++) {
    const h = Math.max(1, (peaks[x] / (top || 1)) * canvas.height * 0.9);
    ctx.fillRect(x, (canvas.height - h) / 2, 1, h);
  }
}
window.addEventListener("resize", () => buffer && drawWave());

// ---------- selection ----------
const clipLen = () => Math.min(Math.max(parseFloat(durEl.value) || 29.9, 1), 40, duration || 40);
const clipStart = () => parseFloat(startEl.value) || 0;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function update() {
  if (!duration) return;
  const max = Math.max(0, duration - clipLen());
  startEl.max = max.toFixed(1);
  if (clipStart() > max) startEl.value = max.toFixed(1);
  sel.style.left = (clipStart() / duration) * 100 + "%";
  sel.style.width = (clipLen() / duration) * 100 + "%";
  info.textContent = `Start ${fmt(clipStart())}  ·  End ${fmt(clipStart() + clipLen())}  ·  Length ${clipLen().toFixed(1)}s  ·  Song ${fmt(duration)}`;
}
function setStart(s) {
  startEl.value = Math.min(Math.max(0, s), Math.max(0, duration - clipLen())).toFixed(1);
  update();
}

startEl.oninput = () => { update(); if (source) play(); };
durEl.oninput = () => { setPreset("custom"); update(); };
document.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => { setStart(clipStart() + parseFloat(b.dataset.n)); if (source) play(); }));

function setPreset(d) {
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", b.dataset.d === d));
}
document.querySelectorAll("#presets button").forEach((b) => (b.onclick = () => {
  setPreset(b.dataset.d);
  if (b.dataset.d !== "custom") durEl.value = b.dataset.d;
  else durEl.focus();
  update();
}));

// Drag the selection box, or tap anywhere to center it there.
let drag = null;
wrap.addEventListener("pointerdown", (e) => {
  if (!duration) return;
  const r = wrap.getBoundingClientRect();
  const t = ((e.clientX - r.left) / r.width) * duration;
  const inside = t >= clipStart() && t <= clipStart() + clipLen();
  drag = { offset: inside ? t - clipStart() : clipLen() / 2 };
  if (!inside) setStart(t - drag.offset);
  wrap.setPointerCapture(e.pointerId);
  sel.style.cursor = "grabbing";
});
wrap.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const r = wrap.getBoundingClientRect();
  setStart(((e.clientX - r.left) / r.width) * duration - drag.offset);
});
wrap.addEventListener("pointerup", () => {
  if (!drag) return;
  drag = null;
  sel.style.cursor = "grab";
  if (source) play();
});

document.addEventListener("keydown", (e) => {
  if (!buffer || e.target.tagName === "INPUT" && e.target.type === "number") return;
  if (e.code === "Space") { e.preventDefault(); source ? stop() : play(); }
  if (e.code === "ArrowLeft") setStart(clipStart() - (e.shiftKey ? 1 : 0.1));
  if (e.code === "ArrowRight") setStart(clipStart() + (e.shiftKey ? 1 : 0.1));
});

// ---------- preview ----------
function play() {
  stop(true);
  actx.resume();
  const len = clipLen(), start = clipStart(), now = actx.currentTime;
  const gain = actx.createGain();
  const fi = $("fadeIn").checked ? Math.min(0.5, len / 4) : 0;
  const fo = $("fadeOut").checked ? Math.min(1.5, len / 4) : 0;
  gain.gain.setValueAtTime(fi ? 0 : 1, now);
  if (fi) gain.gain.linearRampToValueAtTime(1, now + fi);
  if (fo) { gain.gain.setValueAtTime(1, now + len - fo); gain.gain.linearRampToValueAtTime(0, now + len); }
  source = actx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(actx.destination);
  source.start(now, start, len);
  playStartedAt = now; playOffset = start;
  source.onended = () => { if (loop && source) play(); else stop(); };
  playBtn.textContent = "■ Stop";
  head.style.display = "block";
  const tick = () => {
    head.style.left = ((playOffset + actx.currentTime - playStartedAt) / duration) * 100 + "%";
    raf = requestAnimationFrame(tick);
  };
  tick();
}
function stop(keepUi) {
  if (source) { source.onended = null; try { source.stop(); } catch {} source = null; }
  cancelAnimationFrame(raf);
  if (!keepUi) { playBtn.textContent = "▶ Preview"; head.style.display = "none"; }
}
playBtn.onclick = () => (source ? stop() : play());
loopBtn.onclick = () => { loop = !loop; loopBtn.textContent = `🔁 Loop: ${loop ? "on" : "off"}`; };

// ---------- export ----------
const FORMATS = {
  m4r: { args: ["-c:a", "aac", "-b:a", "256k", "-f", "ipod"], mime: "audio/x-m4r" },
  m4a: { args: ["-c:a", "aac", "-b:a", "256k", "-f", "ipod"], mime: "audio/mp4" },
  mp3: { args: ["-c:a", "libmp3lame", "-q:a", "0"], mime: "audio/mpeg" },
  wav: { args: ["-c:a", "pcm_s16le"], mime: "audio/wav" },
};

async function exportAs(fmtKey) {
  if (!file) return;
  const buttons = document.querySelectorAll(".dl");
  buttons.forEach((b) => (b.disabled = true));
  try {
    setStatus(ffmpeg?.loaded ? "Encoding…" : "Loading encoder (~30 MB, first time only)…");
    const ff = await loadFFmpeg();
    setStatus("Encoding…");
    const inName = "src" + ext(file.name);
    if (!(await ff.listDir("/")).some((n) => n.name === inName)) await ff.writeFile(inName, await fetchFile(file));

    const len = clipLen(), start = clipStart();
    const filters = [];
    if ($("norm").checked) filters.push("loudnorm=I=-14:TP=-1:LRA=11");
    if ($("fadeIn").checked) filters.push(`afade=t=in:st=0:d=${Math.min(0.5, len / 4)}`);
    if ($("fadeOut").checked) { const d = Math.min(1.5, len / 4); filters.push(`afade=t=out:st=${(len - d).toFixed(2)}:d=${d}`); }

    const out = "out." + fmtKey;
    const args = ["-y", "-ss", start.toFixed(2), "-t", len.toFixed(2), "-i", inName, "-vn", "-map_metadata", "-1", "-ac", "2", "-ar", "44100"];
    if (filters.length) args.push("-af", filters.join(","));
    args.push(...FORMATS[fmtKey].args, out);

    const code = await ff.exec(args);
    if (code !== 0) throw new Error("ffmpeg exited with code " + code);
    const data = await ff.readFile(out);
    await ff.deleteFile(out);

    const blob = new Blob([data.buffer], { type: FORMATS[fmtKey].mime });
    const name = `${baseName(file.name).slice(0, 60)} (ringtone).${fmtKey}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    setStatus(`✓ Downloaded “${name}” (${(blob.size / 1024).toFixed(0)} KB)`, "ok");
  } catch (e) {
    fail(e);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
document.querySelectorAll(".dl").forEach((b) => (b.onclick = () => exportAs(b.dataset.f)));

function setStatus(msg, cls = "") { status.textContent = msg; status.className = "muted " + cls; }
function fail(e) { console.error(e); setStatus("Error: " + (e?.message || e), "err"); }

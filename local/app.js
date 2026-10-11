"use strict";

const $ = id => document.getElementById(id);
const sourceType = $("source-type");
const startEl = $("start");
const durEl = $("dur");
const wrap = $("wrap");
const playBtn = $("play");
let source = null;
let buffer = null;
let context = null;
let playing = null;
let frame = null;
let importing = false;
let exporting = false;
let dragging = false;
let playbackVersion = 0;

const duration = () => buffer?.duration || 0;
const clipDuration = () => Math.min(Math.max(1, Number(durEl.value) || 30), 40, duration());
const clipStart = () => Number(startEl.value) || 0;
const fmt = value => {
  const tenths = Math.round(value * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

function message(id, text, error = false) {
  $(id).textContent = text;
  $(id).style.color = error ? "#ff9a9a" : "#aeb9cb";
}

function controls() {
  $("source-type").disabled = importing || exporting;
  $("youtube-url").disabled = importing || exporting;
  $("youtube-load").disabled = importing || exporting;
  $("audio-file").disabled = importing || exporting;
  $("clip-controls").disabled = !buffer || importing || exporting;
  $("import-progress").hidden = !importing;
  $("source-form").setAttribute("aria-busy", String(importing));
}

function update() {
  if (!buffer) return;
  const length = clipDuration();
  startEl.max = (Math.floor(Math.max(0, duration() - length) * 10) / 10).toFixed(1);
  startEl.value = Math.min(clipStart(), Number(startEl.max));
  durEl.max = Math.min(40, duration());
  durEl.min = Math.min(1, duration());
  $("sel").style.left = `${clipStart() / duration() * 100}%`;
  $("sel").style.width = `${length / duration() * 100}%`;
  $("start-time").textContent = fmt(clipStart());
  $("info").textContent = `Start: ${fmt(clipStart())} · End: ${fmt(clipStart() + length)} · Length: ${length.toFixed(1)}s · Full audio: ${fmt(duration())}`;
}

function drawWave() {
  const canvas = $("wave");
  const ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * scale);
  canvas.height = Math.round(canvas.clientHeight * scale);
  if (!buffer || !canvas.width) return;
  const data = buffer.getChannelData(0);
  ctx.fillStyle = "#8795ad";
  for (let x = 0; x < canvas.width; x++) {
    let peak = 0;
    const from = Math.floor(x * data.length / canvas.width);
    const to = Math.min(data.length, Math.max(from + 1, Math.floor((x + 1) * data.length / canvas.width)));
    for (let i = from; i < to; i += Math.max(1, Math.floor((to - from) / 120))) peak = Math.max(peak, Math.abs(data[i]));
    const height = Math.max(1, peak * canvas.height * .88);
    ctx.fillRect(x, (canvas.height - height) / 2, 1, height);
  }
}

function stopClip() {
  playbackVersion++;
  cancelAnimationFrame(frame);
  if (playing) {
    playing.node.onended = null;
    playing.node.stop();
    playing.node.disconnect();
    playing.gain.disconnect();
    playing = null;
  }
  playBtn.textContent = "▶ Preview clip";
  playBtn.setAttribute("aria-pressed", "false");
  $("head").hidden = true;
}

async function playClip() {
  if (!buffer || importing || exporting) return;
  stopClip();
  const version = playbackVersion;
  try {
    await context.resume();
    if (version !== playbackVersion || importing || exporting) return;
    const node = context.createBufferSource();
    const gain = context.createGain();
    node.buffer = buffer;
    node.connect(gain).connect(context.destination);
    const length = clipDuration();
    const when = context.currentTime;
    if ($("fade").checked) {
      const fadeIn = Math.min(.5, length / 2);
      const fadeOut = Math.min(1, length / 2);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(1, when + fadeIn);
      gain.gain.setValueAtTime(1, when + length - fadeOut);
      gain.gain.linearRampToValueAtTime(0, when + length);
    }
    playing = { node, gain, when, start: clipStart() };
    node.onended = stopClip;
    node.start(when, clipStart(), length);
    playBtn.textContent = "■ Stop";
    playBtn.setAttribute("aria-pressed", "true");
    $("head").hidden = false;
    function tick() {
      if (!playing) return;
      $("head").style.left = `${(playing.start + context.currentTime - playing.when) / duration() * 100}%`;
      frame = requestAnimationFrame(tick);
    }
    tick();
  } catch (error) { stopClip(); message("status", `Couldn't preview this clip: ${error.message}`, true); }
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}). Please try again.`);
  return data;
}

async function loadSource(next) {
  const response = await fetch(next.audioUrl);
  if (!response.ok) throw new Error("Couldn't load the audio. Please import it again.");
  context ||= new AudioContext();
  const nextBuffer = await context.decodeAudioData(await response.arrayBuffer());
  if (!nextBuffer.duration) throw new Error("This file has no playable audio.");
  // Keep the previous source usable if an import or decode fails.
  source = next;
  buffer = nextBuffer;
  startEl.value = 0;
  durEl.value = Math.min(30, buffer.duration).toFixed(1);
  $("track-title").textContent = next.title;
  $("track-quality").textContent = `${next.quality || "Original audio preserved"} · Lossless preview`;
  $("empty-wave").hidden = true;
  $("sel").hidden = false;
  message("status", "");
  update(); drawWave();
}

async function importSource(url, options, label) {
  if (importing || exporting) return;
  importing = true;
  stopClip(); controls();
  message("source-status", label);
  try {
    const next = await readResponse(await fetch(url, options));
    message("source-status", "Preparing the waveform…");
    await loadSource(next);
    message("source-status", "Audio ready. Select a section below to preview and save.");
  } catch (error) {
    message("source-status", `${error.message}${buffer ? " Your previous audio is still ready below." : ""}`, true);
  } finally { importing = false; controls(); }
}

sourceType.onchange = () => {
  const upload = sourceType.value === "upload";
  $("youtube-panel").hidden = upload;
  $("upload-panel").hidden = !upload;
  $("youtube-url").required = !upload;
};

$("source-form").onsubmit = event => {
  event.preventDefault();
  if (sourceType.value !== "youtube") return;
  const url = $("youtube-url").value.trim();
  importSource("/api/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }, "Extracting the best available audio from YouTube… This can take a minute.");
};

function upload(file) {
  if (!file || importing || exporting) return;
  if (!file.size || file.size > 100 * 1024 * 1024) {
    message("source-status", file.size ? "Choose a file smaller than 100 MB." : "This file is empty. Choose an audio file.", true);
    return;
  }
  importSource("/api/upload", { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) }, body: file }, `Loading ${file.name} at its original quality…`);
}
$("audio-file").onchange = event => { upload(event.target.files[0]); event.target.value = ""; };
const dropZone = $("drop-zone");
dropZone.ondragover = event => { event.preventDefault(); if (!importing && !exporting) dropZone.classList.add("drag-over"); };
dropZone.ondragleave = () => dropZone.classList.remove("drag-over");
dropZone.ondrop = event => {
  event.preventDefault(); dropZone.classList.remove("drag-over");
  if (event.dataTransfer.files.length > 1) return message("source-status", "Drop one audio file at a time.", true);
  upload(event.dataTransfer.files[0]);
};

function selectionChanged() { stopClip(); update(); }
startEl.oninput = selectionChanged;
durEl.oninput = selectionChanged;
durEl.onchange = () => { if (buffer) durEl.value = clipDuration().toFixed(1); update(); };
$("fade").onchange = stopClip;
$("nudgeL").onclick = () => { startEl.value = Math.max(0, clipStart() - .5); selectionChanged(); };
$("nudgeR").onclick = () => { startEl.value = clipStart() + .5; selectionChanged(); };
function moveSelection(event) {
  const rect = wrap.getBoundingClientRect();
  startEl.value = Math.max(0, (event.clientX - rect.left) / rect.width * duration() - clipDuration() / 2).toFixed(1);
  update();
}
wrap.onpointerdown = event => {
  if (!buffer || importing || exporting || event.button !== 0) return;
  stopClip(); dragging = true; wrap.setPointerCapture(event.pointerId); moveSelection(event);
};
wrap.onpointermove = event => { if (dragging) moveSelection(event); };
wrap.onpointerup = wrap.onpointercancel = wrap.onlostpointercapture = () => { dragging = false; };
playBtn.onclick = () => playing ? stopClip() : playClip();
new ResizeObserver(drawWave).observe(wrap);

async function save(format) {
  if (!source || !buffer || importing || exporting) return;
  exporting = true; stopClip(); controls();
  message("status", "Exporting your clip…");
  try {
    const query = new URLSearchParams({ id: source.id, start: clipStart(), dur: clipDuration(), fade: $("fade").checked ? "1" : "0", fmt: format });
    const response = await fetch(`/export?${query}`);
    if (!response.ok) {
      const text = await response.text();
      let error = text;
      try { error = JSON.parse(text).error; } catch {}
      throw new Error(error || "Export failed. Please try again.");
    }
    // The server saves to Downloads; consume the response without a duplicate download.
    if (response.body) {
      const reader = response.body.getReader();
      while (!(await reader.read()).done) {}
    }
    const saved = response.headers.get("X-Saved-Path");
    message("status", saved ? `Saved to ${decodeURIComponent(saved)}` : "Clip saved to Downloads.");
  } catch (error) { message("status", error.message, true); }
  finally { exporting = false; controls(); }
}
$("saveM4r").onclick = () => save("m4r");
$("saveMp3").onclick = () => save("mp3");
$("saveWav").onclick = () => save("wav");

async function initialize() {
  importing = true; controls();
  try {
    const data = await readResponse(await fetch("/api/source"));
    if (data.source) {
      message("source-status", "Loading your existing audio…");
      await loadSource(data.source);
      message("source-status", "Your existing audio is ready. Add a YouTube link or upload a different file above.");
    }
  } catch (error) { message("source-status", `Couldn't restore existing audio. ${error.message}`, true); }
  finally { importing = false; controls(); }
}
initialize();

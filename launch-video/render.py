#!/usr/bin/env python3
"""Render a launch film from genuine browser recordings and an edit manifest.

Usage: .venv/bin/python render.py edit.json --output exports/launch.mp4

Manifest paths are relative to the manifest. A shot is either ``title``,
``footage`` (default), or ``outro``. Footage accepts file, start, duration,
speed, crop [x,y,w,h], box [x,y,w,h], layout (wide/focus/mobile), caption, subcaption,
eyebrow, pan [start_x,start_y,end_x,end_y] (normalized 0–1), and zoom
(default .065). Add aspect="vertical" for 1080x1920.
Top-level audio accepts {file, start, delay, volume, fade_in, fade_out}; start
is the offset within the audio file, delay is its start time in the film.
The renderer never takes sound from
browser recordings implicitly. ``sound_design: true`` adds original, subtle
tonal and transition accents. ``--clean-output`` writes a version with only
those accents; ``--silent-output`` writes a completely silent master.
Fonts are the same open fonts used by the website.
"""

from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
import random
import shutil
import subprocess
import sys
import urllib.request
import wave as wavefile
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
GRAPHICS = ROOT / "work" / "graphics"
GRAPHICS.mkdir(parents=True, exist_ok=True)
BG = "#101115"
INK = "#f6f6f4"
MUTED = "#a6a8b0"
LIME = "#d7f75b"
FONT_URLS = {
    "DM-Sans.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf",
    "InstrumentSerif-Italic.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf",
}


def run(args):
    subprocess.run([str(a) for a in args], check=True)


@lru_cache(maxsize=80)
def font(size, serif=False, weight=600):
    name = "InstrumentSerif-Italic.ttf" if serif else "DM-Sans.ttf"
    path = GRAPHICS / name
    if not path.exists():
        urllib.request.urlretrieve(FONT_URLS[name], path)
    f = ImageFont.truetype(str(path), round(size))
    if not serif:
        try:
            # Google Fonts DM Sans variable axes are optical size and weight.
            f.set_variation_by_axes([14, weight])
        except (OSError, ValueError):
            pass
    return f


def text(draw, xy, value, size, color=INK, serif=False, weight=600, spacing=1.08):
    f = font(size, serif, weight)
    x, y = xy
    for line in value.split("\n"):
        draw.text((x, y), line, font=f, fill=color, anchor="lt")
        y += size * spacing
    return y


def wrap(draw, value, width, size, serif=False, weight=500):
    f = font(size, serif, weight)
    lines = []
    for paragraph in value.split("\n"):
        line = ""
        for word in paragraph.split():
            candidate = (line + " " + word).strip()
            if line and draw.textlength(candidate, font=f) > width:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    return "\n".join(lines)


def logo(draw, x, y, size=48):
    draw.rounded_rectangle((x, y, x + size, y + size), radius=size * .28, fill=LIME)
    for i, h in enumerate((.28, .55, .38)):
        bx = x + size * (.26 + i * .20)
        by = y + size * (1-h)/2
        draw.rounded_rectangle((bx, by, bx + size * .065, by + size*h), radius=size*.035, fill=BG)


def wave(draw, x, y, width, height, count=47, alpha=255, phase=0):
    gap = width / count
    for i in range(count):
        n = i / (count - 1)
        envelope = math.sin(math.pi*n) ** .75
        h = height * (.10 + envelope*(.23 + .56*(.5+.5*math.sin(i*1.31+phase))))
        color = (215, 247, 91, alpha)
        draw.rounded_rectangle((x+i*gap, y+(height-h)/2, x+i*gap+gap*.27, y+(height+h)/2), radius=gap*.135, fill=color)


def shot_graphic(shot, width, height, aspect, number, count, path):
    """Rasterize typography; FFmpeg keeps recordings as actual moving video."""
    vertical = aspect == "vertical"
    im = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    kind = shot.get("kind", "footage")
    layout = shot.get("layout", "wide")
    margin = 72
    if kind in ("title", "outro"):
        im.paste(BG, (0, 0, width, height))
        d = ImageDraw.Draw(im)
        logo(d, margin, margin, 52)
        text(d, (margin+70, margin+8), "Ringtone Cropper", 32, weight=600)
        if vertical:
            ty = 420 if kind == "title" else 380
            headline_size = 116
            max_width = width-2*margin
        else:
            ty = 302 if kind == "title" else 274
            headline_size = 140
            max_width = 1600
        headline = shot.get("caption", "Your sound.")
        if vertical:
            headline = wrap(d, headline, max_width, headline_size, weight=650)
        end = text(d, (margin, ty), headline, headline_size, weight=650, spacing=1.02)
        accent = shot.get("accent", "On repeat." if kind == "title" else "Make it yours.")
        end = text(d, (margin, end+8), accent, headline_size*1.1, LIME, serif=True)
        sub = shot.get("subcaption", "A ringtone that sounds like you.")
        sub = wrap(d, sub, max_width, 38 if vertical else 34)
        text(d, (margin+4, end+45), sub, 38 if vertical else 34, MUTED, weight=400, spacing=1.28)
        if kind == "title":
            wave(d, margin, height-(410 if vertical else 250), width-2*margin, 130 if vertical else 96, 57 if vertical else 83, 210)
            text(d, (margin, height-110), "YOUTUBE LINK  /  AUDIO FILE", 22, MUTED, weight=500)
        else:
            url = shot.get("url", "ringtone.apoorvdarshan.com")
            url_y = height-(360 if vertical else 270)
            d.line((margin, url_y-44, width-margin, url_y-44), fill="#303238", width=2)
            text(d, (margin, url_y), url, 46 if vertical else 48, LIME, weight=550)
            text(d, (margin, url_y+80), "ANDROID + IPHONE   ·   OPEN SOURCE", 25, MUTED, weight=500)
            text(d, (margin, height-105), shot.get("credit", "Built by @apoorvdarshan"), 24, MUTED, weight=400)
        im.save(path)
        return None

    # Keep all explanatory type outside the product footage.
    eyebrow = shot.get("eyebrow", f"{number:02d}  /  YOUR NEXT RINGTONE")
    caption = shot.get("caption", "Make it yours.")
    sub = shot.get("subcaption", "")
    if vertical:
        text(d, (margin, 94), eyebrow.upper(), 23, LIME, weight=600)
        headline = wrap(d, caption, width-2*margin, 83, weight=650)
        end = text(d, (margin, 151), headline, 83, weight=650, spacing=1.04)
        if sub:
            sub = wrap(d, sub, width-2*margin, 31, weight=400)
            text(d, (margin, end+23), sub, 31, MUTED, weight=400, spacing=1.2)
        box = (210, 430, 660, 1428) if layout == "mobile" else (54, 480, 972, 1260)
        text(d, (margin, height-57), "RINGTONE CROPPER", 20, MUTED, weight=550)
    elif layout in ("focus", "mobile"):
        logo(d, margin, 78, 46)
        text(d, (margin, 256), eyebrow.upper(), 22, LIME, weight=600)
        headline = wrap(d, caption, 535, 76, weight=650)
        end = text(d, (margin, 316), headline, 76, weight=650, spacing=1.03)
        if sub:
            sub = wrap(d, sub, 500, 30, weight=400)
            text(d, (margin, end+38), sub, 30, MUTED, weight=400, spacing=1.3)
        text(d, (margin, height-94), "RINGTONE CROPPER", 20, MUTED, weight=550)
        box = (665, 72, 1183, 936) if layout == "focus" else (1104, 56, 446, 966)
        if layout == "mobile":
            # A quiet supporting wave keeps the middle ground intentional.
            wave(d, 703, 344, 285, 270, count=21, alpha=55)
    else:
        text(d, (margin, 50), eyebrow.upper(), 21, LIME, weight=600)
        text(d, (margin, 99), caption, 65, weight=650)
        if sub:
            text(d, (margin+2, 182), sub, 27, MUTED, weight=400)
        logo(d, width-margin-48, 59, 48)
        box = (72, 254, width-144, 766)

    box = tuple(shot.get("box", box))
    # The real screen is rounded during compositing, without fake browser chrome.
    for i in range(count):
        segw = (width-2*margin-(count-1)*8)/count
        left = margin+i*(segw+8)
        d.rectangle((left, height-18, left+segw, height-15), fill=LIME if i < number else "#303238")
    im.save(path)
    return box


def card_animation(shot, width, height, aspect, fps, frames_dir):
    """Stagger real typographic layers and animate the brand waveform."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    vertical = aspect == "vertical"
    kind = shot.get("kind", "title")
    margin = 72
    layers = []

    def layer(delay, slide, painter):
        item = Image.new("RGBA", (width, height))
        painter(ImageDraw.Draw(item))
        layers.append((delay, slide, item))

    layer(0, 12, lambda d: (logo(d, margin, margin, 52), text(d, (margin+70, margin+8), "Ringtone Cropper", 32)))
    ty = (420 if kind == "title" else 380) if vertical else (302 if kind == "title" else 274)
    size = 116 if vertical else 140
    measure = ImageDraw.Draw(Image.new("RGBA", (width, height)))
    headline = shot.get("caption", "Your sound.")
    if vertical:
        headline = wrap(measure, headline, width-2*margin, size, weight=650)
    headline_end = ty + len(headline.split("\n"))*size*1.02
    layer(.03, 64, lambda d: text(d, (margin, ty), headline, size, weight=650, spacing=1.02))
    accent = shot.get("accent", "On repeat." if kind == "title" else "Make it yours.")
    accent_y = headline_end+8
    accent_end = accent_y+size*1.1*1.08
    layer(.18, 55, lambda d: text(d, (margin, accent_y), accent, size*1.1, LIME, serif=True))
    subsize = 38 if vertical else 34
    sub = wrap(measure, shot.get("subcaption", "A ringtone that sounds like you."), width-2*margin, subsize)
    layer(.37, 26, lambda d: text(d, (margin+4, accent_end+45), sub, subsize, MUTED, weight=400, spacing=1.28))
    if kind == "title":
        layer(.5, 10, lambda d: text(d, (margin, height-110), "YOUTUBE LINK  /  AUDIO FILE", 22, MUTED, weight=500))
    else:
        url_y = height-(360 if vertical else 270)
        url = shot.get("url", "ringtone.apoorvdarshan.com")
        layer(.38, 36, lambda d: text(d, (margin, url_y), url, 46 if vertical else 48, LIME, weight=550))
        layer(.49, 20, lambda d: text(d, (margin, url_y+80), "ANDROID + IPHONE   ·   OPEN SOURCE", 25, MUTED, weight=500))
        layer(.58, 14, lambda d: text(d, (margin, height-105), shot.get("credit", "Built by @apoorvdarshan"), 24, MUTED, weight=400))

    count = round(float(shot["duration"])*fps)
    for frame in range(count):
        t = frame/fps
        canvas = Image.new("RGBA", (width, height), BG)
        for delay, slide, item in layers:
            progress = min(1, max(0, (t-delay)/.62))
            ease = 1-(1-progress)**3
            if ease <= 0:
                continue
            current = item
            if ease < 1:
                current = item.copy()
                current.putalpha(item.getchannel("A").point(lambda a: round(a*ease)))
            canvas.alpha_composite(current, (0, round(slide*(1-ease))))
        d = ImageDraw.Draw(canvas)
        if kind == "title":
            amount = min(1, max(0, (t-.28)/.55))
            wave(d, margin, height-(410 if vertical else 250), width-2*margin,
                 130 if vertical else 96, 57 if vertical else 83, round(210*amount), phase=t*3.5)
        else:
            amount = min(1, max(0, (t-.30)/.65))
            length = (width-2*margin)*(1-(1-amount)**3)
            d.line((margin, url_y-44, margin+length, url_y-44), fill="#303238", width=2)
        canvas.convert("RGB").save(frames_dir / f"{frame:04d}.png", compress_level=3)


def base_ffmpeg():
    return ["ffmpeg", "-y", "-hide_banner", "-loglevel", "warning", "-filter_complex_threads", "1"]


def encode_opts(crf=17):
    return ["-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"]


def render_shot(shot, idx, count, config, manifest_dir, cache, force=False):
    aspect = config.get("aspect", "landscape")
    width, height = (1080, 1920) if aspect == "vertical" else (1920, 1080)
    fps = config.get("fps", 30)
    duration = float(shot["duration"])
    if duration <= .4:
        raise ValueError("Each shot must last more than 0.4 seconds.")
    signature = json.dumps({"v": 6, "shot": shot, "aspect": aspect, "fps": fps, "idx": idx, "count": count}, sort_keys=True)
    digest = hashlib.sha256(signature.encode()).hexdigest()[:10]
    target = cache / f"{idx:02d}-{digest}.mp4"
    if target.exists() and not force:
        print(f"Using cached shot {idx}: {target.name}", flush=True)
        return target
    overlay = GRAPHICS / f"{aspect}-{idx:02d}-{digest}.png"
    box = shot_graphic(shot, width, height, aspect, idx, count, overlay)
    kind = shot.get("kind", "footage")
    print(f"Rendering shot {idx}/{count}: {shot.get('caption', kind)}", flush=True)
    if kind in ("title", "outro"):
        frames_dir = GRAPHICS / f"{aspect}-{idx:02d}-{digest}-motion"
        card_animation(shot, width, height, aspect, fps, frames_dir)
        cmd = base_ffmpeg() + ["-framerate", str(fps), "-i", frames_dir / "%04d.png",
            "-vf", "format=yuv420p",
            "-t", str(duration), "-r", str(fps)] + encode_opts() + [target]
        run(cmd)
        return target

    source = (manifest_dir / shot["file"]).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    start = float(shot.get("start", 0))
    speed = float(shot.get("speed", 1))
    x, y, bw, bh = box
    # H264 chroma requires even dimensions.
    bw, bh = bw//2*2, bh//2*2
    filters = [f"setpts=(PTS-STARTPTS)/{speed}", f"fps={fps}"]
    if shot.get("crop"):
        cx, cy, cw, ch = shot["crop"]
        filters.append(f"crop={cw}:{ch}:{cx}:{cy}")
    fit = shot.get("fit", "cover")
    if fit == "contain":
        filters += [f"scale={bw}:{bh}:force_original_aspect_ratio=decrease:flags=lanczos", f"pad={bw}:{bh}:(ow-iw)/2:(oh-ih)/2:color={BG}"]
    else:
        filters += [f"scale={bw}:{bh}:force_original_aspect_ratio=increase:flags=lanczos", f"crop={bw}:{bh}"]
    zoom = float(shot.get("zoom", .065))
    if zoom:
        nframes = max(1, round(duration*fps)-1)
        # Cosine ease has zero speed at both ends; no sharp digital punch.
        ease = f"(0.5-0.5*cos(PI*on/{nframes}))"
        px0, py0, px1, py1 = shot.get("pan", [.5, .5, .5, .5])
        xp = f"(iw-iw/zoom)*({px0}+({px1-px0})*{ease})"
        yp = f"(ih-ih/zoom)*({py0}+({py1-py0})*{ease})"
        filters.append(f"zoompan=z='1+{zoom}*{ease}':x='{xp}':y='{yp}':d=1:s={bw}x{bh}:fps={fps}")
    filters += [f"tpad=stop_mode=clone:stop_duration={duration}", f"trim=duration={duration}", "setsar=1", "format=rgba"]
    # Rounded alpha mask is a compositing treatment, not invented app UI.
    maskpath = GRAPHICS / f"mask-{bw}x{bh}.png"
    if not maskpath.exists():
        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, bw-1, bh-1), 18, fill=255)
        mask.save(maskpath)
    fc = (
        f"[0:v]{','.join(filters)}[footage];"
        f"[3:v]format=gray[mask];[footage][mask]alphamerge,fade=t=in:d=0.25:alpha=1[rounded];"
        f"[1:v][rounded]overlay=x={x}:y='{y}+36*pow(1-min(t/0.6,1),3)':shortest=1[placed];"
        f"[2:v]format=rgba,fade=t=in:d=0.35:alpha=1[graphics];"
        f"[placed][graphics]overlay=x=0:y='24*pow(1-min(t/0.48,1),3)':shortest=1,format=yuv420p[v]"
    )
    cmd = base_ffmpeg() + ["-ss", str(start), "-i", source,
        "-f", "lavfi", "-i", f"color=c={BG}:s={width}x{height}:r={fps}:d={duration}",
        "-loop", "1", "-framerate", str(fps), "-i", overlay,
        "-loop", "1", "-framerate", str(fps), "-i", maskpath,
        "-filter_complex", fc, "-map", "[v]", "-t", str(duration), "-r", str(fps)] + encode_opts() + [target]
    run(cmd)
    return target


def join_shots(files, config, target, crf=16):
    transition = float(config.get("transition", .3))
    durations = [float(s["duration"]) for s in config["shots"]]
    total = sum(durations)-transition*(len(files)-1)
    if transition >= min(durations)/2:
        raise ValueError("Transition duration must be less than half the shortest shot.")
    if len(files) == 1:
        shutil.copyfile(files[0], target)
        return total
    cmd = base_ffmpeg()
    for file in files:
        cmd += ["-i", file]
    fc = [f"[{i}:v]settb=AVTB,setpts=PTS-STARTPTS[v{i}]" for i in range(len(files))]
    current = "v0"
    elapsed = durations[0]
    for i in range(1, len(files)):
        output = f"x{i}"
        fc.append(f"[{current}][v{i}]xfade=transition=fade:duration={transition}:offset={elapsed-transition}[{output}]")
        elapsed += durations[i]-transition
        current = output
    cmd += ["-filter_complex", ";".join(fc), "-map", f"[{current}]", "-t", str(total), "-r", str(config.get("fps", 30))]
    cmd += encode_opts(crf) + [target]
    run(cmd)
    return total


def make_sound_design(config, duration, target):
    """An original, quiet tonal intro and small edit accents; no stock audio."""
    rate = 48000
    samples = array("f", [0]) * round(duration*rate)
    song_start = float(config.get("audio", {}).get("delay", duration))
    rng = random.Random(731)
    for event, root in [(0, 220), (4.5, 174.614), (8.7, 196), (12.4, 220)]:
        if event >= song_start-.2:
            continue
        length = min(3.5, song_start-event)
        for n in range(round(length*rate)):
            t = n/rate
            env = min(1, t/.045)*math.exp(-t/1.15)
            env *= min(1, max(0, (song_start-event-t)/.45))
            tone = sum(math.sin(2*math.pi*root*ratio*t) for ratio in (1, 1.2, 1.5))
            samples[round(event*rate)+n] += .019*env*tone
    elapsed = 0
    transition = float(config.get("transition", .3))
    for shot in config["shots"]:
        event = max(0, elapsed)
        length = min(.3, duration-event)
        filtered = 0
        for n in range(round(length*rate)):
            t = n/rate
            filtered = .84*filtered+.16*rng.uniform(-1, 1)
            env = math.sin(math.pi*t/max(length, .001))**2
            samples[round(event*rate)+n] += .027*env*filtered
        elapsed += float(shot["duration"])-transition
    pcm = array("h")
    for value in samples:
        sample = max(-32767, min(32767, round(value*32767)))
        pcm.extend((sample, sample))
    with wavefile.open(str(target), "wb") as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        stream.writeframes(pcm.tobytes())


def mux_audio(silent, target, audio, manifest_dir, duration, effects=None):
    track = (manifest_dir / audio["file"]).resolve()
    volume = float(audio.get("volume", .8))
    delay = float(audio.get("delay", 0))
    if not 0 <= delay < duration:
        raise ValueError("Audio delay must be within the finished film.")
    active = duration-delay
    fade_in = float(audio.get("fade_in", .35))
    fade_out = float(audio.get("fade_out", 1.5))
    audio_filter = (
        f"atrim=duration={active},asetpts=PTS-STARTPTS,volume={volume},"
        f"afade=t=in:d={fade_in},afade=t=out:st={max(0,active-fade_out)}:d={fade_out},"
        f"alimiter=limit=0.95:level=0:latency=1,adelay={round(delay*1000)}:all=1,apad,atrim=duration={duration}"
    )
    cmd = base_ffmpeg() + ["-i", silent, "-stream_loop", "-1", "-ss", str(audio.get("start", 0)), "-i", track]
    if effects:
        cmd += ["-i", effects, "-filter_complex", f"[1:a]{audio_filter}[song];[song][2:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[mix]", "-map", "0:v:0", "-map", "[mix]"]
    else:
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-af", audio_filter]
    run(cmd + [
        "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
        "-t", str(duration), "-movflags", "+faststart", target])


def mux_effects(silent, effects, target, duration):
    run(base_ffmpeg() + ["-i", silent, "-i", effects, "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
        "-t", str(duration), "-movflags", "+faststart", target])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--silent-output", type=Path)
    parser.add_argument("--clean-output", type=Path)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--only-shot", type=int, help="Render one 1-indexed shot, then exit.")
    args = parser.parse_args()
    manifest = args.manifest.resolve()
    config = json.loads(manifest.read_text())
    if not config.get("shots"):
        parser.error("Manifest needs at least one shot.")
    cache = ROOT / "work" / "render" / config.get("aspect", "landscape")
    cache.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    clips = []
    for idx, shot in enumerate(config["shots"], 1):
        if args.only_shot and args.only_shot != idx:
            continue
        clips.append(render_shot(shot, idx, len(config["shots"]), config, manifest.parent, cache, args.force))
    if args.only_shot:
        shutil.copyfile(clips[0], args.output)
        print(args.output.resolve())
        return
    silent = args.silent_output or cache / "silent-master.mp4"
    silent.parent.mkdir(parents=True, exist_ok=True)
    duration = join_shots(clips, config, silent)
    effects = None
    if config.get("sound_design"):
        effects = GRAPHICS / f"{config.get('aspect', 'landscape')}-original-sound-design.wav"
        make_sound_design(config, duration, effects)
    if config.get("audio"):
        mux_audio(silent, args.output, config["audio"], manifest.parent, duration, effects)
    elif effects:
        mux_effects(silent, effects, args.output, duration)
    elif args.output.resolve() != silent.resolve():
        shutil.copyfile(silent, args.output)
    if args.clean_output:
        args.clean_output.parent.mkdir(parents=True, exist_ok=True)
        if effects:
            mux_effects(silent, effects, args.clean_output, duration)
        else:
            shutil.copyfile(silent, args.clean_output)
    print(json.dumps({"output": str(args.output.resolve()), "duration": round(duration, 3), "audio": bool(config.get("audio")), "aspect": config.get("aspect", "landscape")}))


if __name__ == "__main__":
    main()

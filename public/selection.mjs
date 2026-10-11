export const DEFAULT_LENGTH = 30;
export const MIN_LENGTH = 1;
export const MAX_LENGTH = 40;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const roundTenth = value => Math.round(value * 10) / 10;

// Keep every editable boundary on the 0.1 s grid and inside the actual audio.
// Rounding after clamping can otherwise put the clip past a fractional source end.
export function fitSelection({ start = 0, length = DEFAULT_LENGTH } = {}, duration) {
  const available = Math.floor(Math.max(0, duration) * 10 + 1e-7) / 10;
  const fittedLength = clamp(roundTenth(length), Math.min(MIN_LENGTH, available), Math.min(MAX_LENGTH, available));
  return {
    start: clamp(roundTenth(start), 0, roundTenth(Math.max(0, available - fittedLength))),
    length: fittedLength,
  };
}

export function initialDevice(userAgent, maxTouchPoints = 0) {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
    ? "iphone"
    : "android";
}

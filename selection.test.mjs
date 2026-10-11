import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LENGTH, fitSelection, initialDevice } from "./public/selection.mjs";

test("new sources start with an exact 30 second selection", () => {
  assert.equal(DEFAULT_LENGTH, 30);
  assert.deepEqual(fitSelection({}, 180), { start: 0, length: 30 });
});

test("a short source does not alter the preferred length for the next source", () => {
  for (const length of [15, 30, 40]) {
    const preference = { start: 0, length };
    assert.deepEqual(fitSelection(preference, 8.25), { start: 0, length: 8.2 });
    assert.deepEqual(fitSelection(preference, 120), preference);
  }
});

test("fractional audio boundaries never round beyond the source end", () => {
  for (const duration of [1, 1.06, 29.96, 30.04, 30.06, 40.08, 123.456]) {
    for (const start of [-10, 0, 0.1, 20, 29.95, 99, duration]) {
      for (const length of [0, 1, 15, 29.95, 30, 40, 100]) {
        const clip = fitSelection({ start, length }, duration);
        assert.ok(clip.start >= 0 && clip.length >= 1 && clip.length <= 40);
        assert.ok(clip.start + clip.length <= duration + 1e-9, JSON.stringify({ duration, start, length, clip }));
      }
    }
  }
});

test("moving a selection to the end preserves its requested length", () => {
  assert.deepEqual(fitSelection({ start: 109, length: 30 }, 120.06), { start: 90, length: 30 });
  assert.deepEqual(fitSelection({ start: 12.36, length: 7.81 }, 120), { start: 12.4, length: 7.8 });
});

test("device defaults cover iPhone, desktop-mode iPad, Android, and desktop", () => {
  assert.equal(initialDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)"), "iphone");
  assert.equal(initialDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 5), "iphone");
  assert.equal(initialDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)"), "android");
  assert.equal(initialDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 0), "android");
  assert.equal(initialDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "android");
});

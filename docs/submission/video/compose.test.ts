import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutShots, parsePauses, splitCaptions, timeCaptions } from "./compose.ts";

test("splitCaptions cuts the narration into sentences no longer than the limit", () => {
  const text =
    "A short one. A much longer sentence, which goes on with a clause, and then another clause after it. End.";
  const chunks = splitCaptions(text, 60);
  assert.deepEqual(chunks, [
    "A short one.",
    "A much longer sentence, which goes on with a clause,",
    "and then another clause after it.",
    "End.",
  ]);
  assert.equal(chunks.join(" "), text);
});

test("splitCaptions keeps decimals and 'dot com' inside their sentence", () => {
  assert.deepEqual(splitCaptions("Only 11.2 percent. Live at findyourdent dot com.", 80), [
    "Only 11.2 percent.",
    "Live at findyourdent dot com.",
  ]);
});

test("parsePauses reads silencedetect output as pause midpoints", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 2.85",
    "[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 0.4",
    "size=N/A time=00:00:38.08",
    "[silencedetect @ 0x1] silence_start: 6.5",
    "[silencedetect @ 0x1] silence_end: 7.0 | silence_duration: 0.5",
  ].join("\n");
  assert.deepEqual(parsePauses(stderr), [3.05, 6.75]);
});

test("timeCaptions spreads captions by length and snaps each cut to the nearest pause", () => {
  const timed = timeCaptions(["aaaa", "bbbb", "cc"], [4.4, 7.9], 10);
  assert.deepEqual(timed, [
    { text: "aaaa", start: 0, end: 4.4 },
    { text: "bbbb", start: 4.4, end: 7.9 },
    { text: "cc", start: 7.9, end: 10 },
  ]);
});

test("timeCaptions keeps the estimate when no pause is close", () => {
  const timed = timeCaptions(["aaaa", "aaaa"], [1], 10);
  assert.deepEqual(
    timed.map((caption) => [caption.start, caption.end]),
    [
      [0, 5],
      [5, 10],
    ],
  );
});

test("layoutShots places shots end to end and stretches the last one to fill the scene", () => {
  const laid = layoutShots(
    [
      { kind: "still", card: "a", seconds: 4 },
      { kind: "clip", clip: "x.mp4", from: 10, to: 16, speed: 2, panel: "p" },
      { kind: "clip", clip: "x.mp4", from: 20, to: 25, panel: "p" },
    ],
    15,
  );
  assert.deepEqual(
    laid.map((shot) => [shot.start, shot.seconds, shot.hold]),
    [
      [0, 4, 0],
      [4, 3, 0],
      [7, 8, 3],
    ],
  );
});

test("layoutShots never cuts a shot short: the scene grows to fit the shots", () => {
  const laid = layoutShots([{ kind: "clip", clip: "x.mp4", from: 0, to: 12, panel: "p" }], 10);
  assert.deepEqual(laid.map((shot) => [shot.seconds, shot.hold]), [[12, 0]]);
});

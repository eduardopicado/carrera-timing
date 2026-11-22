// Throttle blips with the car standing still must not count as laps.
//
// Builds a recording from samples/13-laps.m4a: the quiet room from before the
// car starts, with bursts of motor sound pasted in every few seconds, as if
// the throttle were blipped with the car stopped. Includes short blips, a full
// pass sound (swell, clicks, drop) and steady motor sound held for over a
// second (cut from between passes, since a car that isn't moving doesn't
// swell as it goes by the phone).
//
//   ffmpeg -i samples/13-laps.m4a -ac 1 -ar 48000 -f f32le /tmp/laps.f32
//   node test/blips.test.js /tmp/laps.f32 48000
const fs = require('fs');
const path = require('path');
const PassDetector = require(path.join(__dirname, '..', 'detector.js'));

const sr = Number(process.argv[3] || 48000);
const buf = fs.readFileSync(process.argv[2]);
const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const seg = (a, b) => pcm.subarray(Math.round(a * sr), Math.round(b * sr));

const quiet = seg(0.1, 0.95);            // room with the car stopped
const bursts = [
  ['short blip', seg(6.95, 7.30)],
  ['pass sound', seg(6.80, 7.45)],
  ['held 1.5 s', seg(5.00, 6.50)],
  ['short blip', seg(9.70, 10.05)],
  ['held 1.4 s', seg(10.60, 12.00)],
];
const SECONDS = 40, out = new Float32Array(SECONDS * sr);
for (let i = 0; i < out.length; i++) out[i] = quiet[i % quiet.length];
const placed = [];
let t = 2.0;
for (let k = 0; t < SECONDS - 3; k++) {
  const [name, b] = bursts[k % bursts.length];
  const at = Math.round(t * sr), fade = Math.round(0.03 * sr);
  for (let i = 0; i < b.length; i++) {
    const g = Math.min(1, i / fade, (b.length - 1 - i) / fade);
    out[at + i] = out[at + i] * (1 - g) + b[i] * g;
  }
  placed.push(`${name} @${t.toFixed(1)}s`);
  t += b.length / sr + 1.8 + (k % 3) * 0.6;
}

let failed = false;
for (const rise of [6, 10, 12]) {
  const d = new PassDetector(sr, { rise });
  const laps = [];
  for (let i = 0; i < out.length; i += 128) laps.push(...d.process(out.subarray(i, i + 128)).map((p) => p.t.toFixed(2)));
  console.log(`rise ${rise}: ${laps.length} laps counted${laps.length ? ' at ' + laps.join(', ') : ''}`);
  if (laps.length) failed = true;
}
console.log(`${placed.length} bursts: ${placed.join(', ')}`);
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);

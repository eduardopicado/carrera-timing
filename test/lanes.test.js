// Synthetic check for the camera lane watcher: a textured grey track, a red car
// with the same brightness as the track crossing the box every 2.5 s, camera
// noise, auto-exposure drift and a shadow.
//   node test/lanes.test.js
const path = require('path');
const LaneWatcher = require(path.join(__dirname, '..', 'lanes.js'));

const W = 24, H = 12, FPS = 30, LAP = 2.5, SECONDS = 30;
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const track = Array.from({ length: W * H }, () => 70 + rand() * 40);

function frame(t) {
  const exposure = 1 + 0.25 * Math.sin(t / 3);            // slow auto-exposure drift
  const shadow = t > 12 && t < 14 ? -30 : 0;              // someone leans over
  const phase = (t % LAP) / LAP;                          // car crosses at phase 0..0.06
  const carX = phase < 0.06 ? Math.floor((phase / 0.06) * (W + 10)) - 10 : -99;
  const g = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = track[y * W + x];
    // Pure red at 300 has grey level 0.299 * 300 = 90: the same as the track.
    const rgb = (x >= carX && x < carX + 10 && y > 2 && y < 10) ? [300, 0, 0] : [v, v, v];
    for (let k = 0; k < 3; k++) {
      g[(y * W + x) * 3 + k] = Math.max(0, Math.min(255, rgb[k] * exposure + shadow + (rand() - 0.5) * 8));
    }
  }
  return g;
}

const w = new LaneWatcher();
const laps = [];
for (let f = 0; f < SECONDS * FPS; f++) {
  const t = f / FPS + 0.5;                                // start mid-lap so frame 1 is empty track
  if (w.process(frame(t), t)) laps.push(t);
}
const gaps = laps.slice(1).map((t, i) => t - laps[i]);
const expected = Math.floor(SECONDS / LAP);
const ok = laps.length === expected && gaps.every(g => Math.abs(g - LAP) < 1.5 / FPS);
console.log(`laps ${laps.length} (expected ${expected}), gaps ${gaps.map(g => g.toFixed(3)).join(' ')}`);
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);

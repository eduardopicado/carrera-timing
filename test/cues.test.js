// Lap sounds must not be timed as laps when the phone hears its own beeps.
//
// Replays samples/13-laps.m4a with the cue for each lap mixed in right after
// the lap is detected, loud (as loud as the car at its closest, and louder),
// plain and with speaker distortion (harmonics), and checks the detector finds
// exactly the same laps. Also checks which cue each lap gets.
//
//   ffmpeg -i samples/13-laps.m4a -ac 1 -ar 48000 -f f32le /tmp/laps.f32
//   node test/cues.test.js /tmp/laps.f32 48000
const fs = require('fs');
const path = require('path');
const PassDetector = require(path.join(__dirname, '..', 'detector.js'));
const { renderCue, lapKind } = require(path.join(__dirname, '..', 'cues.js'));

let failed = false;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed = true; };

// Which cue each lap gets.
check(lapKind([2.5], Infinity) === 'first', 'first lap of the session: first');
check(lapKind([2.5, 2.4], 2.5) === 'best', 'quicker than the session best: best');
check(lapKind([2.3, 2.4, 2.35], 2.3) === 'faster', 'quicker than the lap before, not a best: faster');
check(lapKind([2.3, 2.35, 2.4], 2.3) === 'slower', 'slower than the lap before: slower');
check(lapKind([2.2], 2.1) === 'slower', 'lane 2 first lap, slower than lane 1 best: slower');
check(lapKind([2.0], 2.1) === 'best', 'lane 2 first lap, quicker than lane 1 best: best');

const sr = Number(process.argv[3] || 48000);
const buf = fs.readFileSync(process.argv[2]);
const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

function detect(signal) {
  const d = new PassDetector(sr), passes = [];
  for (let i = 0; i < signal.length; i += 128) {
    for (const p of d.process(signal.subarray(i, i + 128))) {
      if (p.amend && passes.length) passes[passes.length - 1] = p.t; else passes.push(p.t);
    }
  }
  return passes;
}

const base = detect(pcm);
const laps = base.slice(1).map((t, i) => t - base[i]);
for (const [label, peak, distortion] of [['as loud as the car', 0.6, 0], ['full scale', 1.0, 0], ['full scale, distorted speaker', 1.0, 0.1]]) {
  const mixed = Float32Array.from(pcm);
  let best = Infinity;
  laps.forEach((lap, k) => {
    const kind = lapKind(laps.slice(0, k + 1), best);
    best = Math.min(best, lap);
    const cue = renderCue(kind, sr, peak);
    const at = Math.round((base[k + 1] + 0.03) * sr);    // 30 ms after the lap is detected
    for (let i = 0; i < cue.length && at + i < mixed.length; i++) {
      const c = cue[i] + distortion * (cue[i] * cue[i] * Math.sign(cue[i]) - cue[i] * cue[i] * cue[i]) * 4;
      mixed[at + i] = Math.max(-1, Math.min(1, mixed[at + i] + c));
    }
  });
  const got = detect(mixed);
  const same = got.length === base.length && got.every((t, i) => Math.abs(t - base[i]) < 0.005);
  check(same, `cues ${label}: ${got.length - 1} laps, ${same ? 'same as without cues' : 'differs: ' + got.map((t) => t.toFixed(2)).join(' ')}`);
}

console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);

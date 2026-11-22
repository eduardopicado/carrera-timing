// Runs the detector over the sample recording and checks it finds all 14
// passes (13 laps) with no extras.
//
//   ffmpeg -i samples/13-laps.m4a -ac 1 -ar 48000 -f f32le /tmp/laps.f32
//   node test/detector.test.js /tmp/laps.f32 48000
const fs = require('fs');
const path = require('path');
const PassDetector = require(path.join(__dirname, '..', 'detector.js'));

const file = process.argv[2];
const sr = Number(process.argv[3] || 48000);
const buf = fs.readFileSync(file);
const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);

// Where each pass's drop-off lands, measured offline from samples/13-laps.m4a.
// A detected lap matches if it is within MATCH seconds.
const truth = [1.76, 4.64, 7.31, 10.01, 12.52, 15.18, 18.01, 20.51, 22.92, 25.47, 27.97, 30.28, 32.73];
const MATCH = 0.12;

function run(opts) {
  const d = new PassDetector(sr, opts);
  const laps = [];
  for (let i = 0; i < pcm.length; i += 128) {
    for (const p of d.process(pcm.subarray(i, i + 128))) {
      if (p.amend && laps.length) laps[laps.length - 1] = p.t; else laps.push(p.t);
    }
  }
  return laps.filter(t => t < 35.0); // the last pass at ~35 s overlaps the recording being stopped
}

let failed = false;
console.log('rise\\drop', [8, 10, 12, 15].map(d => String(d).padStart(9)).join(''));
for (const rise of [6, 8, 10, 12, 14, 16, 18]) {
  const cells = [8, 10, 12, 15].map(drop => {
    const laps = run({ rise, drop });
    const hit = truth.filter(c => laps.some(t => Math.abs(t - c) < MATCH)).length;
    const extra = laps.filter(t => !truth.some(c => Math.abs(t - c) < MATCH)).length;
    if (rise === 12 && drop === 12 && (hit !== truth.length || extra)) failed = true;
    return `${hit}/${truth.length}${extra ? '+' + extra : '  '}`.padStart(9);
  });
  console.log(String(rise).padStart(9), cells.join(''));
}

const laps = run({});
console.log('defaults: passes at', laps.map(t => t.toFixed(2)).join(' '));
console.log('lap times', laps.slice(1).map((t, i) => (t - laps[i]).toFixed(2)).join(' '));
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);

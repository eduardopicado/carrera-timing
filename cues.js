/*
 * Lap sounds: short tone patterns that say how a lap went, so the driver can
 * keep their eyes on the track.
 *
 *   best    three rising notes   a new best lap of the session
 *   faster  two rising notes     quicker than the lap before
 *   slower  two falling notes    slower than the lap before
 *   first   one note             first lap done, nothing to compare yet
 *
 * Pure sine tones between 587 Hz and 1175 Hz. The mic detector listens above
 * 2 kHz, so its own filter cuts these by 20 dB or more and the phone doesn't
 * time its own beeps as laps (see test/cues.test.js).
 */
const LAP_CUES = {
  best: [[784, 0, 0.12], [988, 0.11, 0.12], [1175, 0.22, 0.24]],
  faster: [[587, 0, 0.1], [784, 0.1, 0.16]],
  slower: [[784, 0, 0.1], [587, 0.1, 0.16]],
  first: [[880, 0, 0.12]],
};

/** How long a cue lasts, in seconds. */
function cueLength(kind) {
  return Math.max.apply(null, LAP_CUES[kind].map(function (n) { return n[1] + n[2]; }));
}

/** Gain of one note at time x seconds into it: 5 ms attack, then exponential decay. */
function cueEnvelope(x, dur) {
  if (x < 0 || x > dur) return 0;
  return x < 0.005 ? x / 0.005 : Math.exp(-4 * (x - 0.005) / dur);
}

/** Play a cue through Web Audio at context time `when`; returns when it ends. */
function playCue(ctx, kind, when, volume) {
  const out = ctx.createGain();
  out.gain.value = volume == null ? 0.6 : volume;
  out.connect(ctx.destination);
  LAP_CUES[kind].forEach(function (n) {
    const freq = n[0], start = when + n[1], dur = n[2];
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(1, start + 0.005);
    g.gain.exponentialRampToValueAtTime(Math.exp(-4), start + dur);
    g.gain.linearRampToValueAtTime(0, start + dur + 0.01);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  });
  return when + cueLength(kind);
}

/** Render a cue to samples (for tests). */
function renderCue(kind, sampleRate, peak) {
  const n = Math.ceil(cueLength(kind) * sampleRate) + 1, out = new Float32Array(n);
  LAP_CUES[kind].forEach(function (note) {
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate, x = t - note[1];
      out[i] += (peak == null ? 1 : peak) * cueEnvelope(x, note[2]) * Math.sin(2 * Math.PI * note[0] * x);
    }
  });
  return out;
}

/**
 * Which cue a lap gets. laps: this lane's lap times including the new one;
 * prevOverall: the session best before this lap (Infinity if none).
 */
function lapKind(laps, prevOverall) {
  const n = laps.length, last = laps[n - 1];
  if (n === 1 && !isFinite(prevOverall)) return 'first';
  if (last < prevOverall) return 'best';
  if (n === 1) return last <= prevOverall ? 'faster' : 'slower';
  return last < laps[n - 2] ? 'faster' : 'slower';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { LAP_CUES, cueLength, renderCue, lapKind };

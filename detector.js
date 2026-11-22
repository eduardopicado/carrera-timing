/*
 * PassDetector: finds the moment the car passes the phone in a stream of mono
 * audio samples.
 *
 * Self-contained on purpose: the page also runs it inside an AudioWorklet by
 * passing PassDetector.toString() to the worklet, so it must not reference
 * anything outside this class.
 *
 * What a pass sounds like (samples/13-laps.m4a, phone beside the lap counter):
 * the motor swells for ~250 ms as the car approaches, peaks with a cluster of
 * clicks as it trips the counter, then the level falls away sharply within
 * ~100 ms. The clicks inside the cluster vary from lap to lap, but the drop
 * after them lands at the same point every lap, so that drop is the timing
 * mark.
 *
 * Method:
 *  1. High-pass at 2 kHz (two cascaded biquads) to lose rumble, handling
 *     noise and most of the motor hum.
 *  2. Energy in 2 ms frames, smoothed over 20 ms, in dB.
 *  3. Background = median level over the last 2 s.
 *  4. When the level rises `rise` dB over the background a pass starts and its
 *     peak is tracked. When the level then falls `drop` dB below that peak, the
 *     lap is stamped at that moment.
 *  5. No new pass can start for `minLap` seconds after a lap, unless it is
 *     much louder (`amend` dB over the last pass's peak). That pass then
 *     replaces the previous lap's time.
 *  6. A pass only counts while the car is running: the background (the 2 s
 *     median) must be `runGap` dB above the quietest the room has been, which
 *     is the car stopped. Blipping the throttle with the car standing still
 *     swells and drops just like a pass, but the background stays at the
 *     quiet-room level. Such a swell is followed to its drop and ignored. The
 *     cost: the car must run for about a second before passes count, so the
 *     first crossing after pulling away from a standstill may be missed.
 */
class PassDetector {
  constructor(sampleRate, opts) {
    opts = opts || {};
    this.sr = sampleRate;
    this.rise = opts.rise != null ? opts.rise : 12;      // dB over background to start a pass
    this.drop = opts.drop != null ? opts.drop : 12;      // dB below the peak to stamp the lap
    this.minLap = opts.minLap != null ? opts.minLap : 1.2; // seconds
    this.amend = opts.amend != null ? opts.amend : 6;    // dB louder to replace the last lap
    this.floorDb = opts.floorDb != null ? opts.floorDb : -70; // ignore anything quieter
    this.runGap = opts.runGap != null ? opts.runGap : 10; // dB over the quiet room = car running
    this.maxPass = 1.0;                                  // a pass longer than this is abandoned

    this.frameLen = Math.max(1, Math.round(sampleRate * 0.002));
    this.frameSec = this.frameLen / sampleRate;
    this.smoothLen = 10;                                 // 10 x 2 ms = 20 ms
    this.smooth = new Float64Array(this.smoothLen);
    this.smoothPos = 0;
    this.smoothSum = 0;
    this.histLen = 1000;                                 // 1000 x 2 ms = 2 s
    this.hist = new Float32Array(this.histLen);
    this.histPos = 0;
    this.histFill = 0;
    this.sinceBg = 0;
    this.bg = -120;
    this.recent = -120;                                  // median level over the last 0.5 s
    this.quiet = null;                                   // quietest 0.5 s median so far: the car stopped
    this.quietFrame = 0;

    this.acc = 0;
    this.accN = 0;
    this.frameIndex = 0;
    this.state = 0;                                      // 0 idle, 1 in a pass, 2 in an ignored swell
    this.peak = -120;
    this.passStart = 0;
    this.lastLapFrame = -1e12;
    this.lastPeak = -120;
    this.amending = false;

    this.level = -120;                                   // latest level, for meters
    this.meterPeak = -120;                               // max (level - bg) since last read
    this._setupFilter(2000);
  }

  _setupFilter(fc) {
    // RBJ high-pass biquad, Q = 1/sqrt(2); two in series.
    const w0 = 2 * Math.PI * fc / this.sr;
    const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0;
    this.b1 = -(1 + cos) / a0;
    this.b2 = (1 + cos) / 2 / a0;
    this.a1 = -2 * cos / a0;
    this.a2 = (1 - alpha) / a0;
    this.z = new Float64Array(8);
  }

  setOptions(opts) {
    if (opts.rise != null) this.rise = opts.rise;
    if (opts.drop != null) this.drop = opts.drop;
    if (opts.minLap != null) this.minLap = opts.minLap;
    if (opts.floorDb != null) this.floorDb = opts.floorDb;
    if (opts.amend != null) this.amend = opts.amend;
    if (opts.runGap != null) this.runGap = opts.runGap;
  }

  /** Forget the last lap, e.g. when a new session starts. */
  reset() {
    this.state = 0;
    this.lastLapFrame = -1e12;
    this.lastPeak = -120;
    this.amending = false;
    if (this.state === 1) this.state = 0;
  }

  _updateBackground() {
    const n = this.histFill;
    const copy = Array.prototype.slice.call(this.hist, 0, n);
    copy.sort(function (a, b) { return a - b; });
    this.bg = copy[n >> 1];

    // Median of the most recent 0.5 s.
    const m = Math.min(n, 250), last = new Array(m);
    for (let k = 0; k < m; k++) last[k] = this.hist[(this.histPos - 1 - k + this.histLen) % this.histLen];
    last.sort(function (a, b) { return a - b; });
    this.recent = last[m >> 1];

    // The quiet floor follows the quietest moments, creeping up 0.05 dB/s so
    // a phone moved somewhere noisier recovers within a few minutes.
    const f = this.frameIndex;
    if (n < 250) return;                                 // filters still settling: levels read low
    if (this.quiet === null) this.quiet = this.recent;
    else this.quiet = Math.min(this.recent, this.quiet + 0.05 * (f - this.quietFrame) * this.frameSec);
    this.quietFrame = f;
  }

  /** True when the car sounds like it is running rather than standing still. */
  running() {
    return this.quiet !== null && this.bg >= this.quiet + this.runGap;
  }

  /**
   * Feed a block of samples. Returns the passes found in this block as
   * {t, amend} objects: t is seconds since the first sample this detector saw;
   * amend is true when the pass replaces the previous one instead of adding.
   */
  process(input) {
    const out = [];
    const z = this.z, b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
    for (let i = 0; i < input.length; i++) {
      let x = input[i];
      let y = b0 * x + b1 * z[0] + b2 * z[1] - a1 * z[2] - a2 * z[3];
      z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y;
      x = y;
      y = b0 * x + b1 * z[4] + b2 * z[5] - a1 * z[6] - a2 * z[7];
      z[5] = z[4]; z[4] = x; z[7] = z[6]; z[6] = y;

      this.acc += y * y;
      if (++this.accN < this.frameLen) continue;

      const e = this.acc / this.accN;
      this.acc = 0;
      this.accN = 0;
      this.smoothSum += e - this.smooth[this.smoothPos];
      this.smooth[this.smoothPos] = e;
      this.smoothPos = (this.smoothPos + 1) % this.smoothLen;
      const L = 10 * Math.log10(Math.max(this.smoothSum / this.smoothLen, 1e-14));
      const f = this.frameIndex++;
      this.level = L;

      this.hist[this.histPos] = L;
      this.histPos = (this.histPos + 1) % this.histLen;
      if (this.histFill < this.histLen) this.histFill++;
      if (++this.sinceBg >= 25 || this.histFill < 100) { // refresh every 50 ms
        this.sinceBg = 0;
        this._updateBackground();
      }
      if (this.histFill < 100) continue;                   // 200 ms to settle

      const over = L - this.bg;
      if (over > this.meterPeak) this.meterPeak = over;

      if (this.state === 0) {
        if (over >= this.rise && L >= this.floorDb) {
          const free = (f - this.lastLapFrame) * this.frameSec >= this.minLap;
          if (!this.running()) {
            this.state = 2;                                // swell from a standstill: follow it, ignore it
            this.peak = L;
          } else if (free || L > this.lastPeak + this.amend) {
            this.state = 1;
            this.peak = L;
            this.passStart = f;
            this.amending = !free;
          }
        }
      } else if (this.state === 2) {
        if (L > this.peak) this.peak = L;
        if (L <= this.peak - this.drop) this.state = 0;
      } else {
        if (L > this.peak) this.peak = L;
        if (L <= this.peak - this.drop) {
          this.state = 0;
          if (!this.amending || this.peak > this.lastPeak + this.amend) {
            this.lastLapFrame = f;
            this.lastPeak = this.peak;
            // Stamp at the end of this frame, minus the smoothing delay (half the window).
            out.push({ t: (f + 1 - this.smoothLen / 2) * this.frameSec, amend: this.amending });
          }
        } else if ((f - this.passStart) * this.frameSec > this.maxPass) {
          this.state = 0;                                  // never dropped: not a pass
        }
      }
    }
    return out;
  }

  /** Highest level over background (dB) since the last call, for a meter. */
  takeMeter() {
    const m = this.meterPeak;
    this.meterPeak = -120;
    return { over: m, level: this.level, background: this.bg, inPass: this.state === 1, running: this.running() };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = PassDetector;

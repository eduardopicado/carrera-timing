/*
 * LaneWatcher: spots a car crossing a box drawn over one lane in the camera
 * picture.
 *
 * Each frame it gets the colours of the pixels inside the box, as interleaved
 * R,G,B values. It keeps a slowly updated picture of the empty track and
 * scores each frame by how much the box differs from it. Colour matters: a red
 * car on grey track can have the same brightness as the track. Each channel is
 * compared after subtracting its average over the box, so the camera's
 * auto-exposure or a passing shadow doesn't look like a car. A lap is the
 * moment the score first goes over `threshold`, then the lane is locked for
 * `minLap` seconds.
 */
class LaneWatcher {
  constructor(opts) {
    opts = opts || {};
    this.threshold = opts.threshold != null ? opts.threshold : 18; // mean colour difference, 0-255
    this.minLap = opts.minLap != null ? opts.minLap : 1.2;          // seconds
    this.learn = opts.learn != null ? opts.learn : 0.05;            // background update rate
    this.channels = opts.channels || 3;                             // values per pixel
    this.bg = null;
    this.present = false;
    this.presentSince = 0;
    this.lastLap = -Infinity;
    this.score = 0;
  }

  setOptions(opts) {
    if (opts.threshold != null) this.threshold = opts.threshold;
    if (opts.minLap != null) this.minLap = opts.minLap;
  }

  /** Start over, e.g. after the box moves. */
  reset() {
    this.bg = null;
    this.present = false;
    this.lastLap = -Infinity;
  }

  /** Forget the last lap but keep the learned background. */
  resetLaps() {
    this.lastLap = -Infinity;
  }

  _means(a) {
    const c = this.channels, m = new Float64Array(c);
    for (let i = 0; i < a.length; i++) m[i % c] += a[i];
    const px = a.length / c;
    for (let k = 0; k < c; k++) m[k] = px ? m[k] / px : 0;
    return m;
  }

  /**
   * px: the pixels in the box (0-255), `channels` values per pixel, same size
   * every frame. t: frame time in seconds. Returns true when this frame is a
   * new lap.
   */
  process(px, t) {
    const n = px.length, c = this.channels;
    if (!this.bg || this.bg.length !== n) {
      this.bg = Float32Array.from(px);
      this.present = false;
      return false;
    }
    const mc = this._means(px), mb = this._means(this.bg);
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs((px[i] - mc[i % c]) - (this.bg[i] - mb[i % c]));
    const score = diff / n;
    this.score = score;

    let lap = false;
    if (score >= this.threshold) {
      if (!this.present) {
        this.present = true;
        this.presentSince = t;
        if (t - this.lastLap >= this.minLap) {
          this.lastLap = t;
          lap = true;
        }
      }
    } else if (score < this.threshold * 0.6) {
      this.present = false;  // hysteresis: must clearly leave before it can count again
    }

    // Learn the empty track. Freeze while something is in the box, unless it
    // stays for more than 3 s (a parked car or a change in the scene).
    const rate = !this.present ? this.learn : (t - this.presentSince > 3 ? 0.2 : 0);
    if (rate > 0) {
      const bg = this.bg;
      for (let i = 0; i < n; i++) bg[i] += (px[i] - bg[i]) * rate;
    }
    return lap;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = LaneWatcher;

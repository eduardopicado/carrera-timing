# Pit Wall

A lap timer for a Carrera GO!!! slot car track that runs in Safari on an iPhone or iPad. It needs no app install and no extra hardware.

- **Mic · 1 car.** Put the phone beside the lap counter. Each time the car passes, the app hears it and records the lap.
- **Camera · 2 cars.** Prop the phone above the start line looking down. Draw a box over each lane, and each car is timed in its own lane.

It shows the running lap, last, best and average lap, and a lap list. The fastest lap is purple, a lane's own best is green, and a lap slower than the one before is yellow. Race mode (5–30 laps) shows the finishing order and total time. It can also call out lap times and keep the screen awake.

## Using it

1. Open **https://eduardopicado.github.io/carrera-timing/** in Safari. Safari only allows the mic and camera on https pages. Use Share › Add to Home Screen to get an app icon.
2. **Mic:** place the phone within about 20 cm of the lap counter and press **Start**. The first time the car passes starts lap 1.
3. **Camera:** turn on the camera and tap **Draw lane 1 box**. Drag a narrow box across lane 1 just past the line, then do the same for lane 2. Press **Start**. The number on each box shows how much the picture is changing, and it should jump when a car goes through.

If laps are missed or extra laps appear, use **Settings**:

| Setting | Missed laps | Extra laps |
|---|---|---|
| Mic trigger (dB) | lower it | raise it |
| Camera trigger | lower it | raise it |
| Shortest possible lap | lower it (keep it below your fastest lap) | raise it |

**Check a recording** runs the mic detector over a Voice Memos recording, so you can test settings without the track running.

## How the mic detection works

Measured on `samples/13-laps.m4a` (13 laps, about 2.5 s each), a pass sounds the same every lap. The motor swells for about 250 ms as the car approaches, and a cluster of clicks comes as it trips the counter. Then the level falls away sharply within about 100 ms. The clicks inside the cluster vary from lap to lap, so timing from the loudest click makes lap times jump by up to 0.2 s. The drop-off after the clicks lands at the same point every lap, so `detector.js` uses it as the timing mark:

1. High-pass at 2 kHz, then measure loudness in 2 ms steps, smoothed over 20 ms.
2. Background = median loudness over the last 2 s.
3. A pass starts when the level is `rise` dB over the background (12 by default). The lap is stamped when the level falls `drop` dB (12) below the pass's peak.
4. Nothing counts for `minLap` seconds after a lap, except a much louder pass, which replaces it.
5. Passes only count while the car is running: the 2 s background must be 10 dB above the quietest the room has been (the car stopped). Blipping the throttle with the car standing still swells and drops just like a pass, but the background stays at the quiet-room level, so it is ignored. The meter shows "car running" or "car stopped". The car has to run for about a second before passes count, so the first crossing after pulling away from a standstill may not be counted.

On the sample this finds every pass after the first (12 laps) with no extras, for any trigger from 6 to 14 dB, at both 44.1 and 48 kHz. Lap times match the offline analysis to within 0.02 s. `test/blips.test.js` pastes blips and held throttle into the stopped-car silence from the same recording and checks that none count.

The detector runs in an AudioWorklet, with a main-thread fallback for older Safari. The mic is opened with echo cancellation, noise suppression and auto-gain turned off, so iOS doesn't filter out the clicks.

## How the camera detection works

`lanes.js` keeps a slowly updated picture of the empty track inside each box. Each frame is scored by how much its colours differ from that picture, with each colour channel's average subtracted so auto-exposure and shadows don't count as cars. Colour matters: a red car can be exactly as bright as grey track. A lap is the first frame over the trigger, and timing is accurate to one camera frame (about 17 ms at 60 fps).

## Files

- `index.html`: the app (UI, mic and camera handling)
- `detector.js`: mic pass detector
- `lanes.js`: camera lane watcher
- `samples/13-laps.m4a`: the reference recording
- `test/`: detector tests

## Deploying

`.github/workflows/pages.yml` runs the tests on every pull request. On every push to `main` it runs them again and publishes the app to GitHub Pages. One-time setup: in Settings › Pages, set **Source** to **GitHub Actions**.

## Tests

```sh
ffmpeg -i samples/13-laps.m4a -ac 1 -ar 48000 -f f32le /tmp/laps.f32
node test/detector.test.js /tmp/laps.f32 48000
node test/blips.test.js /tmp/laps.f32 48000
node test/lanes.test.js
```

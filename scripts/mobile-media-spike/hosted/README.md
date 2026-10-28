# Hosted phone playback experiment

Standalone static test project, separate from VRDex application hosting.
Vercel project `vrdex-mobile-playback-test`, team `basicbit`.

The build generates two 35-minute prerecorded HLS samples with FFmpeg: a video
clock and tone, and audio-only tone. FFmpeg runs only during the build. The
deployed page uses native HLS, PiP and Media Session controls, with downloadable
logs and notes kept on the device. No backend, live relay or production keys.

Build locally from the repository root with system FFmpeg:

```sh
node scripts/mobile-media-spike/hosted/build.mjs
```

Output is ignored under `apps/web/playwright-artifacts/mobile-media-static`.
For standalone Vercel builds, upload `build.mjs`, `index.html`, `client.js`,
`package.json`, and `vercel.json` from this directory. Install with `npm install`
and build with `npm run build`; publish `dist`. `ffmpeg-static` is pinned to
5.2.0 for that build. Do not include this README or generated media as inputs.

On a phone: choose a mode, Start test, use PiP for video, switch apps, lock for
15–30 minutes, then return and Save log. Record audible interruptions and phone
OS in the notes. Test each mode separately. Samples end after 35 minutes.

Local Chromium verification: both modes advanced, video entered PiP, log
download succeeded and zero page errors occurred. FFprobe durations were 2100
seconds for video and 2100.032 seconds for audio. The 390-pixel layout was
inspected visually. This does not establish phone background/lock behavior,
audible output, live VRCDN delivery or production lineup/Web Audio behavior.

Vercel's default project authentication is retained. Use a deployment-scoped
shareable URL for phone access where available; do not disable project protection.

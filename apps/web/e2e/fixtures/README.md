# Synthetic persistent playback media

`persistent-synthetic.mpegts` contains 45 seconds of FFmpeg-generated testsrc2
video (320x180, 15fps, H.264) and a generated 440Hz sine (AAC, 48kHz). No external
media, performance, recording, or provider stream is included. The generated
fixture is dedicated to CC0 for repository testing. It is about 1.1 MB.

Reproduce with FFmpeg including libx264 and the native AAC encoder:

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'testsrc2=size=320x180:rate=15' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -t 45 -c:v libx264 -preset veryfast -pix_fmt yuv420p -b:v 120k -g 30 \
  -c:a aac -b:a 32k -f mpegts persistent-synthetic.mpegts
```

Normal browser tests read the checked-in fixture, so FFmpeg is only a generation
prerequisite. The browser intercept fulfills a canonical VRCDN URL; playback uses
the production loader, mpegts.js demuxing/MSE, decoding and audio graph. No product
transport override or remote media fetch is used. Finite fixture EOF is not a live
provider or long-duration reconnect test.

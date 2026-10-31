# Task 11 local evidence

These are captured local synthetic runs, not production capacity or billing
measurements. No provider or hosted resource was called. The release gate remains
blocked. See [verification and proposal](../../media-relay-verification.md).

| Measurement | Normal | Delayed keyframes |
| --- | ---: | ---: |
| Duration ms | 20164 | 12170 |
| Maximum sources | 2 | 2 |
| Upstream bytes | 15195672 | 24422008 |
| Video audience bytes | 13406844 | 0 |
| Audio audience bytes | 638072 | 0 |
| Replay bytes | 13314912 | 0 |
| CPU seconds, sampled process tree | 2.799796 | 0.96041 |
| Sampled RSS bytes | 141062144 | 91148288 |
| Sampled total disk bytes | 8269816 | 427526 |
| Sampled partial disk bytes | 0 | 0 |
| Literal .tmp peak bytes | 0 | 0 |
| Pending publications peak | 2 | 0 |
| Cold startup ms | 2219 | 0 |
| Warm recovery ms | 3225 | 0 |
| Cache hits | 60 | 0 |

Normal: two 3 Mbps synthetic video inputs plus AAC, 20 seconds, two-second
keyframes, two simultaneous disconnects/recoveries, zero failures. Pressure:
two 8 Mbps inputs, 12 seconds, 60-second keyframe interval; expected readiness and
recovery failures, no completed media PUT. Both cleaned children and scratch to
zero. Normal requested duration ended with some audience/replay operations still
in progress; separate byte counters report actual consumed data, not estimates.

The earlier pressure run in `pressure-prior-observed.json` sampled 24,507,832
literal `.tmp` bytes and 24,935,358 total bytes. The latest run sampled zero
partial bytes and 427,526 total bytes. Live directory inspection showed completed
audio while video was buffered; transient flush/cleanup writes can be missed.
These observations invalidate any claim that the 32 MiB completed-object cap
bounds partial disk or buffers. They do not establish a 30-second pressure bound.

CPU/RSS include the proof process and sampled accessible descendants, with source
generation in the same proof tree; short-window peaks are noisy. These captures
precede the final additive `sampledProcessesPeak` counter/direct encoder-PID
sampling improvement; final focused tests cover that diagnostic too. Neither run
is an isolated production worker cgroup proof. Exact JSON retains termination
logs; there were no timestamp warnings. All operation counts are local adapter
transport calls, not billed AWS operations.

Commands (toolchain activated; loopback permission, proxy/CA preserved):

```bash
node --import tsx scripts/media-relay-proof.ts --sources 2 --duration 20 --deadline 40 --output docs/engineering/evidence/media-relay-task11/normal
node --import tsx scripts/media-relay-proof.ts --sources 2 --bitrate 8000000 --keyframe 60 --duration 12 --deadline 25 --output docs/engineering/evidence/media-relay-task11/pressure
```

Normal exited 0; pressure exited 1 as expected. JSON timestamps identify exact
captures. The full development report, RED/GREEN logs and review notes are in the
local task report `.superpowers/sdd/mobile-vrcdn-playback/task-11-report.md`.

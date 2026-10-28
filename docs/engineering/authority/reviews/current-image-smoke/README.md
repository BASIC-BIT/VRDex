# October 28 current-image streaming smoke

The worker built from `69e5622a92a1dff05be66abdcf7674a71c482ad1` passed its
132 native transport contracts on Fargate and a short private test of two real
Twitch inputs, downscaling and manual controls. The owned `basicbit1` VRCDN
account passed its publishing and playback codec smoke.

| Check | Observed result |
| --- | --- |
| Packaged source | All 134 packaged files matched the reviewed checkout. |
| Actual image smoke | Node 22.23.4, FFmpeg 5.1.9, Python 3.11.2, locked Streamlink 8.6.2. |
| Fargate native contracts | All 42 Python and 90 Node named outcomes passed. |
| Two real Twitch inputs | Both decoders observed 1920×1080 before scaling. |
| Program output | H.264 1280×720 at 30 fps; AAC 48 kHz stereo. The encoder requested 320 kbps. |
| Operator controls | Take source 1, cut to slate and return to source 0 all acknowledged successfully, with advancing encoded output after each operation. |
| Independent recording check | Two complete private downloads matched length and SHA-256. The independent check examined 1,537 packets; maximum gap was 0.033334 seconds and maximum GOP was 1 second. |
| VRCDN `basicbit1` | Publisher completed 60.010 seconds of output and eight control commands. Playback reported H.264 720p30 and AAC 48 kHz stereo. |
| VRCDN `basicbit` | Publication was rejected before output progress. Playback returned a 720p60 stream; this run did not establish its origin. |
| Provider cleanup | All eight temporary tasks stopped, all eight definitions became inactive, all eight ENIs were absent and the cluster had no running tasks. |

The immutable ECR manifest digest is
`sha256:e74e3c2d3859d09df95c5e2de82f515a8f055aa36290996ade6ef5a1206fd508`.
Its local image/config ID is
`sha256:586c8916eed26f8054d68cad5fc1dcf373ff138a570da14cba62a0907cfade2f`.
All test tasks used 4 vCPU and 8 GiB in `us-east-1`. The candidate remains in the
existing ECR repository, whose lifecycle retains the most recent 20 images.

## Scope and remaining work

The successful Twitch recording is about 20 seconds long and remains private.
Its requested acquisition profile was 1080p60; the test measured input dimensions,
not decoded input frame rate. Output format and packet continuity were checked
independently. A readiness loss during deliberate source retirement/reacquisition
is present in the receipt; this is not a zero-loss soak result.

Initial channel candidates returned no playable renditions. The retained negative
runs and bounded resolver probes explain how the working pair was selected.
They remain separate results. The final successful pair was `shroud` and `eslcs`,
viewed privately without a publishing sender.

The VRCDN smoke used synthetic media and the existing publisher. Its playback
check established codec headers, without verifying content identity or freshness.
The rejected `basicbit` publication could reflect the saved credential, an existing
publisher or provider policy; the test does not distinguish them. The complete
two-account relay rehearsal remains blocked. The dedicated rehearsal switch
remained false throughout.

Automatic silence/death handoff, sustained dual-input operation, all 24 capacity
outcomes, source-marker qualification and physical VRChat playback remain open.
The production measured allocation table remains empty. These smoke results do
not grant production admission or replace those acceptance gates.

## Retained evidence

[reviewed-results.zip](./reviewed-results.zip) contains the exact private test
controllers, reviews, source hashes, provider launch/terminal/cleanup readbacks,
complete receipt reads and independent recording checks. [retention.json](./retention.json)
records every archive member's size and SHA-256. The
[independent retention review](./retention-review.md) passed after checking the
originals and scope. Media and signed download URLs
are excluded. The private S3 recordings expire on November 5, 2026, at 00:00 UTC.

Compute for the eight tasks is estimated at $0.049 using the previously recorded
standard rate and conservative pull-to-stop durations. That estimate excludes
network and storage charges. Existing cost reservations were preserved, with
$16.56346 conservatively held against the user's $20 authorization. No compute
remained running at closure.

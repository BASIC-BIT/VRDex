# Encoded transition fixture correction

Locked decision: Ruling 61 permits only the synthetic pulse construction correction
and one additional pure regression. The owner gate now requires 90 Node and the
unchanged 42 Python outcomes, 132 total. The separate 79,996-case qualification
construction and authority remain unchanged.

The positive zero-lag and negative 0.130667-second lag fixtures submit flashes and
beeps at seconds 1, 2, 3, 4 and 6, 7, 8, 9. Both generators now restrict their
existing 100-ms periodic pulse gate to [1,5) and [6,10). Amplitude 0.65, continuous
sine phase, 700/1300-Hz source identity, visual identity epochs, 12-second coverage,
libx264/AAC 160k encoding, selections and lag are unchanged. The lag negative now
requires the complete exception reason `marker_context_failure:av_out_of_bounds`.

## Retained actual expected-negative evidence

The [full captured facts](../../tests/fixtures/event-encoded-continuing-train.json)
are an exact byte copy of original `facts.json`, including all 12 classified audio
episodes and their fits, all 11 visuals, bindings, ranges and both context results.
The packaged pure regression supplies those original arrays to `associateContext`
and compares both complete outputs to the captured results. It does not project,
clip, retime, filter or reclassify observations. It checks all eight pairs and the
complete five dispositions per context, including each sole `unaccounted_episode`
failure. Its fixture is included in the worker packaging manifest because the
owner test reads it.

The original continuing construction remains an expected negative. Its endpoint
pulses at 5 and 10 seconds yield detector episode 5 at sample 242816 and episode 10
at sample 482912. Their context endpoints are samples 243200 and 483200, so their
first metadata-aligned 480-sample loud blocks overlap the preceding transitions by
384 and 288 samples (8 and 6 ms). Their corresponding visuals start exactly at the
exclusive context endpoints, video PTS 456000 and 906000. Each context therefore
has four `paired_full` dispositions and one `failure` with visual ID -1. All eight
pair offset numerators are `[-6240,-4320,-2400,-480,-3840,-1920,0,-6240]`; the
unchanged absolute bound is 72000 (100 ms).

Original PCM arithmetic found that post-boundary energy alone exceeds the unchanged
full-block RMS threshold in both crossing blocks. Tiny nonzero prefixes exist,
but codec pre-echo was not established as the cause. Captured classifier results
are retained observations; this regression does not independently rerun the classifier.

## Original construction and provenance

Original audio input argument (literal runtime filter text):

```text
aevalsrc=if(lt(mod(t\,1)\,0.1)\,0.65*sin(2*PI*if(lt(t\,6)\,700\,1300)*t)\,0):s=48000
```

Original video filter argument:

```text
drawbox=x=0:y=0:w=4:h=6:color=red:t=fill:enable='gte(t,1)*lt(t,6)',drawbox=x=0:y=0:w=4:h=6:color=blue:t=fill:enable='gte(t,6)',drawbox=x=4:y=0:w=5:h=6:color=white:t=fill:enable='gte(t,1)*lt(mod(t,1),0.1)'
```

Original zero-lag audio filter: `asetpts=PTS+0/TB`. The lag loop was `[0, 0.130667]`.
The original source emitted additional audio at 0, 5, 10, 11 and visuals at 5, 10,
11 seconds. These captured facts remain intact in the expected-negative fixture.

- Original source: `b71eca040ee3981a0ccd687794b78a5a089823fe`.
- Original image: `sha256:f53bcec6b3cc4e84b1b08544c36d66bd3fe497a66027cd668585bdf47dc44c59`.
- Source inventory SHA256: `318fa5bb66e605c5d88751f4396e2b7358f01684a941495ae53f1c9b6180c7fd` (87 verified source files).
- Original fixture block SHA256: `e4ae07165f8a856fbf45117ea687abbbc25d49042ecb1d4b53df05814630d86c`.
- Run: `task6-b71eca04-encoded-zero-diagnostic-20261024-01`; Node `v22.23.4`.
- Original artifact directory: `private-artifacts/task6-b71eca04-encoded-zero-diagnostic` in the task evidence workspace.
- Root receipt: `root-task6-encoded-diagnostic-originals-actual01.json`, SHA256 `1a9eca99950f19bc99ca042c24087019e26f7c374cd2ee4c6300e9fc4be509d1`.
- Causal report: `task-6-encoded-actual-causal-analysis.md`, SHA256 `f3d325c6d4eb005d6703d57b53d6640a3395e7469e864491e45dd9220aeb0bdb`.

The actual capture command exited 0, but its original test failed (1 test, 0 pass,
1 fail); `measureSucceeded=false`. Production stopped on A's
`marker_context_failure:unaccounted_episode`. The diagnostic association recorded
B's same failure separately. Diagnostic pairs do not constitute successful media
measurement. Root recorded closure as STOPPED0 / definitionINACTIVE /
exacteniabsent / cluster0; this correction performs no new native closure check.

Original records, independently checked against Root's receipt:

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `original.ts` | 248348 | `4c5672a67863c2819fa22e22140364c6856025feb3fc8251e99bf65141aa41fc` |
| `decoded.pcm` | 1155072 | `55174883320981056b6e06813b9d59bface1af663aadb5eb6c8febaab4939135` |
| `decoded.rgb` | 2160 | `ad861bdfd8311f4a144fb49a9010dba558de96de0d502790e427b86fcf8589cf` |
| `audio-rows.json` | 23476 | `4156223b51761a805fd41d69184a26f2d5efe233ac3c80241c088d791716382a` |
| `video-rows.json` | 9606 | `8ca650f10c30b0888c364db3d97c3ac55091d638f125573df14fd73cbc5db912` |
| `packets.json` | 500281 | `c98d8d5ce7135eabe99dd68d2323d65e7778c8cc3db109d69f38030b5c78b594` |
| `facts.json` | 13357 | `a3589a7195a845e82ef2afb32a222087e969dc8acac0e6854fd2e2d9d25de85b` |
| `commands.json` | 1014 | `2e2df775ba56e9362bc856c3ca68f2270824f192494c37f04220dc864613823a` |
| `result.json` | 3652 | `8b132ab3d1f8c68952b05cc7fa2242f916d73f04a6afb3d94ba88a8ec3f564fd` |
| `source-pins.json` | 15329 | `4874066d02b733609a6f7ca438cb0e28e02ca6c899a68db9a2327c63bbd5b8f0` |
| `stdout.log` | 1073 | `65bfc5f1d27f798073de58dc88d504a60de2aeb493729de9d155340af826376c` |
| `stderr.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `terminal.json` | 4081 | `dbf55dd528572aeaecbcda264e0e49ece054304f02976ed81d06d0a44a6606bc` |

Relevant original source pins (unchanged by this correction):

| Source | SHA256 |
| --- | --- |
| `scripts/event-capacity-media.mjs` | `dead215ee5707a4cd3d6bdabf91a9310d28df140b21eb69de786a963850ce130` |
| `scripts/event-marker-association.mjs` | `0e9ca7c93122172d9d2a0e9db23b38482dde50b5ee81600701f4f9dce8a608e4` |
| `scripts/event-marker-contexts.mjs` | `80fbfe4a159ef69276eb06f3d476af29331f206662720476aeb25523f66937f9` |
| `scripts/event-marker-evidence.mjs` | `d12f3e44a23f833b4b924a2226d557f9a28eefae74a542927231f1cc4227dab7` |
| `scripts/event-marker-metadata.mjs` | `c464c1a40dc87889b62f222adf43bf8d4f0cc44002761f88770d838e49277404` |
| `scripts/event-marker-record.mjs` | `ee7557ea24b5fa72bcdca90549bf55d1109edf39dc4345e0bed8d59cdf60e06f` |
| `scripts/event-source-marker-qualification.mjs` | `78c79cdfa7a6ddd52151f61d91f50b2272d6453649d0dcddda4a1c63a43651c5` |
| `scripts/event-source-markers.mjs` | `fb3702bb5490af42a10260d2f961a6f6b114eeab8015e1c2e21869a7489b6e64` |

## Verification limits

The new pure regression was checked under local Node v24.19.0 with test isolation
disabled. Temporarily changing only episode 5's onset from 242816 to endpoint
243200 made the test fail: A became valid, lost `unaccounted_episode` and omitted
its fifth disposition. Restoring the original bytes passed. This is mutation
sensitivity evidence for the preserved negative, not a media execution of the
corrected generator.

Actual encoding of the corrected positive and 131-ms negative remains OPEN. Root
must verify all eight valid pairs and both valid zero-lag transitions, plus the
negative's exact lag failure, with complete prerequisites on the final image.
The full 132-outcome gate, final-image qualification, canary, map and capacity gates
remain OPEN. No detector, association, evidence, worker runtime, threshold, window,
fence, onset rule, carry exception or time/resource budget changed.

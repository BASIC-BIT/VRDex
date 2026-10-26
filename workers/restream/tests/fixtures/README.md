# Synthetic Twitch fixtures

The executable recipe is `SyntheticHLSContracts.setUpClass` in
`../test_twitch_input.py`. It generates four seconds of FFmpeg `testsrc2`
(320x180/30) and an audible 440 Hz sine (48 kHz stereo), H264/AAC, one-second
segments, in both MPEGTS HLS and fMP4 HLS with `EXT-X-MAP`. Tests generate an
AES-128 key/IV and encrypted segment from this owned synthetic media. No
third-party media or signed provider locator is checked in.

The fixture starts a verified TLS server with a generated test CA and matching
SAN. A private test seam maps a validated synthetic public IPv4 address to that
loopback server. Production CLI/options expose no policy or TLS override.
Tests cover key/init/segment redirects, unsupported schemes, scheme-relative
references, byte ranges, discontinuities, metadata/actual codec mismatch,
three-second cold resolution, delayed segment delivery, advertisement markers,
and a failed locator followed by fresh canonical resolution.

`research-negative-summary.json` preserves selected bounded observations from
the October 22 research, including the failed buffered v2 start and early
five-second decoder guard during cold acquisition. These are historical local
FFmpeg 7.1.5 observations. They do not establish deployed FFmpeg behavior,
30-minute continuity, a real Twitch advertisement, or forced token expiry.
The production modules import no research fixture or temporary script.

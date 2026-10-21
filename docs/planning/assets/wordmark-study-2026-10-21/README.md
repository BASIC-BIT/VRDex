# VRDex wordmark study

Outlined SVG interpretations of the uppercase VRDEX wordmark in the organizer
concept. The generated mockup has no recoverable font or vector source. These
use Open Sans Semibold 1.10 as a close, reproducible interpretation, rather than
claiming an exact extraction.

| Variant | VR | DEX | Files |
| --- | --- | --- | --- |
| Single color | `#EDF3FA` | `#EDF3FA` | [SVG](./vrdex-wordmark-mono.svg), [PNG](./vrdex-wordmark-mono.png) |
| Cool gray | `#EDF3FA` | `#C7D1DE` | [SVG](./vrdex-wordmark-cool-gray.svg), [PNG](./vrdex-wordmark-cool-gray.png) |
| Soft cyan | `#EDF3FA` | `#B4D5E5` | [SVG](./vrdex-wordmark-soft-cyan.svg), [PNG](./vrdex-wordmark-soft-cyan.png) |

The [comparison PNG](./wordmark-comparison.png) shows the same outlined geometry
at 500 px and 140 px on the charcoal interface surface. Individual PNGs have
transparent backgrounds. Each variant also has a `-navbar.png` proof at its
actual 140 px export width. The comparison's [SVG](./wordmark-comparison.svg)
is self-contained, including outlined labels.

Current recommendation: soft cyan. It separates DEX visibly at navigation size
while staying close to the pale-cyan interface accent. Cool gray is a quieter
alternative. This is a branding candidate, not a production change or evidence
that the color alone explains the name's reference to a directory/index.

## Reproduce

From the repository root, with Python FontTools and the workspace's installed
Sharp package available:

```sh
python docs/planning/assets/wordmark-study-2026-10-21/build_wordmarks.py
```

Default font source:
`/usr/share/fonts/truetype/open-sans/OpenSans-Semibold.ttf`.
Pass `--font /path/to/OpenSans-Semibold.ttf` on another machine. The exact font
SHA-256 and output geometry are recorded in [manifest.json](./manifest.json).
Changing the font changes the letterforms; this script does not fetch fonts or
install dependencies.

The script converts the five glyphs into two SVG paths, VR and DEX, with
0.8 px tracking at a 100 px cap height. Named path IDs make their colors easy to
edit. Each standalone SVG has a transparent canvas, a proportional viewBox and
16 px padding. No live text, embedded raster artwork, external fonts, linked
resources or scripts are required to display it.

Sharp rasterizes those actual SVG files into 900 × 248 px transparent PNGs and
140 × 39 px navbar proofs. The 1400 × 900 px comparison PNG is rendered from
the comparison SVG. PNGs are not image-generation approximations.

## Verification

All SVGs were parsed and checked for duplicate IDs and external/live-text
dependencies. PNG dimensions and alpha channels were read back. The comparison
PNG was visually inspected at its large and navbar sizes. No production app
files or brand settings were changed.

## Typeface provenance

Open Sans Semibold 1.10: Digitized data copyright 2011 Google Corporation.
The installed source font identifies Apache License 2.0. The upstream license
is included as [LICENSE-OpenSans.txt](./LICENSE-OpenSans.txt); the font file
itself is not bundled.

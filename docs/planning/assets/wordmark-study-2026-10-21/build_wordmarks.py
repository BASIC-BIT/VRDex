#!/usr/bin/env python3
"""Build self-contained outlined SVG wordmarks and render their PNG proofs."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import subprocess
from pathlib import Path
from xml.etree import ElementTree

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
VARIANTS = {
    "mono": {"label": "A / Single color", "dex": "#EDF3FA", "note": "VR + DEX  #EDF3FA"},
    "cool-gray": {"label": "B / Cool gray DEX", "dex": "#C7D1DE", "note": "VR  #EDF3FA    DEX  #C7D1DE"},
    "soft-cyan": {"label": "C / Soft cyan DEX", "dex": "#B4D5E5", "note": "VR  #EDF3FA    DEX  #B4D5E5"},
}
VR_COLOR = "#EDF3FA"
BACKGROUND = "#0B0D12"
PADDING = 16
CAP_HEIGHT = 100
TRACKING_PX = 0.8


def outlines(font: TTFont, text: str, *, tracking: float = 0) -> tuple[str, float]:
    """Return one path containing all glyphs and the text's advance width."""
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyphs)
    advance = 0.0
    for index, char in enumerate(text):
        name = cmap[ord(char)]
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, advance, 0)))
        advance += font["hmtx"].metrics[name][0]
        if index < len(text) - 1:
            advance += tracking
    return pen.getCommands(), advance


def svg_header(width: float, height: float, title: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width:.3f}" height="{height:.3f}" '
        f'viewBox="0 0 {width:.3f} {height:.3f}" role="img" '
        'aria-labelledby="title">'
        f'<title id="title">{html.escape(title)}</title>'
    )


def text_path(font: TTFont, text: str, x: float, baseline: float, size: float, color: str) -> str:
    path, _ = outlines(font, text)
    scale = size / font["head"].unitsPerEm
    return (
        f'<path fill="{color}" d="{path}" '
        f'transform="translate({x} {baseline}) scale({scale:.8f} {-scale:.8f})"/>'
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--font", type=Path,
        default=Path("/usr/share/fonts/truetype/open-sans/OpenSans-Semibold.ttf"),
    )
    args = parser.parse_args()
    font = TTFont(args.font)
    cap_units = font["OS/2"].sCapHeight
    scale = CAP_HEIGHT / cap_units
    tracking = TRACKING_PX / scale
    vr_path, vr_advance = outlines(font, "VR", tracking=tracking)
    dex_path, dex_advance = outlines(font, "DEX", tracking=tracking)
    dex_x = vr_advance + tracking
    word_width = (dex_x + dex_advance) * scale
    width = word_width + 2 * PADDING
    height = CAP_HEIGHT + 2 * PADDING
    font_sha = hashlib.sha256(args.font.read_bytes()).hexdigest()

    def logo_group(dex_color: str, *, with_ids: bool = True) -> str:
        vr_id = ' id="vr"' if with_ids else ''
        dex_id = ' id="dex"' if with_ids else ''
        return (
            f'<g transform="translate({PADDING} {PADDING + CAP_HEIGHT}) '
            f'scale({scale:.8f} {-scale:.8f})">'
            f'<path{vr_id} fill="{VR_COLOR}" d="{vr_path}"/>'
            f'<path{dex_id} fill="{dex_color}" d="{dex_path}" '
            f'transform="translate({dex_x:.4f} 0)"/>'
            '</g>'
        )

    manifest = {
        "font": "Open Sans Semibold 1.10",
        "font_sha256": font_sha,
        "reference": "Vector interpretation of the generated organizer mockup wordmark",
        "cap_height": CAP_HEIGHT,
        "tracking_px": TRACKING_PX,
        "view_box": [0, 0, round(width, 3), height],
        "vr_color": VR_COLOR,
        "variants": VARIANTS,
        "renderer": "Sharp, rasterizing the actual SVG files",
    }
    for key, variant in VARIANTS.items():
        svg = (
            svg_header(width, height, f'VRDex wordmark, {key}')
            + '<metadata>Open Sans Semibold 1.10 outlines; Apache-2.0; '
            + f'font SHA-256 {font_sha}</metadata>'
            + logo_group(variant["dex"])
            + '</svg>\n'
        )
        (HERE / f"vrdex-wordmark-{key}.svg").write_text(svg)

    # Every label on the proof sheet is also outlined. The comparison SVG has
    # no font, bitmap, script, stylesheet, URL or external-resource dependency.
    sheet = [svg_header(1400, 900, "VRDex wordmark color comparison")]
    sheet.append(f'<rect width="1400" height="900" fill="{BACKGROUND}"/>')
    sheet.append(text_path(font, "VRDEX wordmark study", 64, 72, 38, "#EDF3FA"))
    sheet.append(text_path(font, "Same letterforms. A slight change in DEX color.", 64, 111, 20, "#98A3B3"))
    sheet.append(text_path(font, "500 px proof", 350, 158, 17, "#98A3B3"))
    sheet.append(text_path(font, "140 px navbar", 1050, 158, 17, "#98A3B3"))

    for index, (key, variant) in enumerate(VARIANTS.items()):
        y = 180 + index * 215
        sheet.append(f'<rect x="48" y="{y}" width="1304" height="192" rx="9" fill="#11161E" stroke="#28313D"/>')
        sheet.append(text_path(font, variant["label"], 72, y + 56, 21, "#EDF3FA"))
        sheet.append(text_path(font, variant["note"], 72, y + 88, 12, "#98A3B3"))
        sheet.append(f'<svg x="334" y="{y+26}" width="500" height="{500*height/width:.4f}" viewBox="0 0 {width:.3f} {height:.3f}">{logo_group(variant["dex"], with_ids=False)}</svg>')
        sheet.append(f'<rect x="1026" y="{y+56}" width="276" height="76" rx="6" fill="#0B0D12" stroke="#28313D"/>')
        sheet.append(f'<svg x="1042" y="{y+75}" width="140" height="{140*height/width:.4f}" viewBox="0 0 {width:.3f} {height:.3f}">{logo_group(variant["dex"], with_ids=False)}</svg>')
        sheet.append('<circle cx="1266" cy="' + str(y+94) + '" r="12" fill="#28313D"/>')

    sheet.append(text_path(font, "Vector interpretation of the mockup; transparent individual SVG and PNG files included.", 64, 858, 16, "#98A3B3"))
    sheet.append('</svg>\n')
    (HERE / "wordmark-comparison.svg").write_text(''.join(sheet))

    # Use the workspace's installed Sharp package, without modifying packages.
    render_js = r'''
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[1]);
const dir = process.argv[2];
const variants = ['mono', 'cool-gray', 'soft-cyan'];
(async () => {
  for (const name of variants) {
    const src = path.join(dir, `vrdex-wordmark-${name}.svg`);
    await sharp(src, {density: 288}).resize({width: 900}).png().toFile(path.join(dir, `vrdex-wordmark-${name}.png`));
    await sharp(src, {density: 288}).resize({width: 140}).png().toFile(path.join(dir, `vrdex-wordmark-${name}-navbar.png`));
  }
  await sharp(path.join(dir, 'wordmark-comparison.svg')).png().toFile(path.join(dir, 'wordmark-comparison.png'));
})().catch(error => {console.error(error); process.exit(1);});
'''
    subprocess.run(
        ["node", "-e", render_js, str(ROOT / "apps/web/node_modules/sharp"), str(HERE)],
        check=True,
    )
    (HERE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    for svg_path in HERE.glob("*.svg"):
        tree = ElementTree.fromstring(svg_path.read_text())
        for element in tree.iter():
            tag = element.tag.rsplit("}", 1)[-1]
            assert tag not in {"text", "image", "script", "foreignObject", "use"}, (svg_path, tag)
            assert not any("href" in key for key in element.attrib), svg_path
        assert "url(" not in svg_path.read_text()
    print(f"Built 3 outlined SVG variants, 6 transparent PNG proofs, and an outlined comparison SVG/PNG in {HERE}")


if __name__ == "__main__":
    main()

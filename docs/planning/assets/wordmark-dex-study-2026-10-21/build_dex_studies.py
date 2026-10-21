#!/usr/bin/env python3
"""Build DEX-only variations around the approved open-upper-R wordmark."""
from pathlib import Path
import hashlib
import html
import json
import subprocess
import xml.etree.ElementTree as ET

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
FONT = Path('/usr/share/fonts/truetype/open-sans/OpenSans-Semibold.ttf')
WHITE, CYAN = '#EDF3FA', '#B4D5E5'
PADDING, CAP = 16, 100

# Approved A, copied byte-for-byte from the earlier stroke study. Every variant
# keeps this contour, the V, their positions and their spacing unchanged.
UPPER_R = 'M432 584V0H193V782H598Q765 782 840 844Q915 906 915 1028Q915 1152 834 1206Q753 1260 590 1260H193V1462H606Q889 1462 1025 1356Q1161 1250 1161 1036Q1161 763 877 647L1290 0H1018L668 584Z'

# Exact quadratic subsegments preserve the D bowl except for a deliberate
# lower-right break. The opening is part of the contour, with transparent alpha.
OPEN_D = 'M193 0V1462H645Q994 1462 1188 1274Q1382 1086 1382 745Q1382 527.8 1309.64 371.98L1068.9632 434.4816Q1130 554.76 1130 737Q1130 1262 639 1262H432V201H602Q829.04 201 958.5248 300.1064L1200.5975 211.07625Q1191.05 201.075 1181 191.5Q980 0 602 0Z'

# A real EX ligature. The E stem and middle/bottom arms remain full. Only its
# top arm extends into the X's upper-left diagonal; the X sits 54.7 font units
# closer than the control. No R/E subtraction or VR fusion is reused here.
JOINED_EX = 'M1020 0H193V1462H1401L1739 909L2077 1462H2335L1878 754L2370 0H2095L1729 598L1360 0H1104L1589 758L1265.2663 1260H432V862H983V662H432V203H1020Z'

STUDIES = [
    ('control', 'Control / Approved A', 'Open upper R; original DEX', 'DEX'),
    ('open-d', '1 / Open D', 'A lower-right opening in the bowl', 'DEX'),
    ('split-x', '2 / Split X crossing', 'One diagonal passes through the other', 'DEX'),
    ('joined-ex', '3 / Joined EX', 'The top E arm meets the X diagonal', 'DEX'),
    ('titlecase-dex', '4 / Titlecase Dex', 'A word-like suffix, without extra cuts', 'Dex'),
]


def path_for(font, text):
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    pen, advance = SVGPathPen(glyphs), 0
    for c in text:
        name = cmap[ord(c)]
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, advance, 0)))
        advance += font['hmtx'].metrics[name][0]
    return pen.getCommands(), advance


def clip_polygon(points, a, b, limit, keep_above):
    """Clip a polygon against one half-plane and return direct outline points."""
    result = []
    for previous, current in zip(points[-1:] + points[:-1], points):
        p = a * previous[0] + b * previous[1] - limit
        c = a * current[0] + b * current[1] - limit
        p_in = p >= 0 if keep_above else p <= 0
        c_in = c >= 0 if keep_above else c <= 0
        if p_in != c_in:
            t = p / (p-c)
            result.append((previous[0]+t*(current[0]-previous[0]),
                           previous[1]+t*(current[1]-previous[1])))
        if c_in:
            result.append(current)
    return result


def polygon_path(points):
    return 'M' + 'L'.join(f'{x:.4f} {y:.4f}' for x, y in points) + 'Z'


def split_x_path():
    # The descending stroke is continuous. The two rising arms stop 80 font
    # units from its edges. These polygons are exported as paths, never masks.
    descending = [(35,1462),(301,1462),(1270,0),(995,0)]
    rising = [(4,0),(260,0),(1235,1462),(977,1462)]
    upper = clip_polygon(rising, 1, 969/1462, 1350, True)
    lower = clip_polygon(rising, 1, 960/1462, 915, False)
    return ''.join(polygon_path(p) for p in [descending, upper, lower])


def header(width, height, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.3f}" height="{height:.3f}" viewBox="0 0 {width:.3f} {height:.3f}" role="img" aria-label="{html.escape(title)}"><title>{html.escape(title)}</title>'


def main():
    font = TTFont(FONT)
    scale = CAP / font['OS/2'].sCapHeight
    tracking = .8 / scale
    glyphs = {c: path_for(font, c) for c in 'VRDEXex'}
    assets, metadata = {}, []
    fixed_vr = None
    for key, title, note, suffix in STUDIES:
        paths, x = [], 0
        for c in 'VR':
            paths.append((UPPER_R if c == 'R' else glyphs[c][0], x, WHITE))
            x += glyphs[c][1] + tracking
        if fixed_vr is None:
            fixed_vr = paths.copy()
        assert paths == fixed_vr
        e_origin = None
        for c in suffix:
            d = glyphs[c][0]
            if key == 'open-d' and c == 'D':
                d = OPEN_D
            elif key == 'split-x' and c == 'X':
                d = split_x_path()
            elif key == 'joined-ex' and c == 'E':
                d, e_origin = JOINED_EX, x
            if key == 'joined-ex' and c == 'X':
                x = e_origin + 1100
            else:
                paths.append((d, x, CYAN))
            x += glyphs[c][1] + tracking
        width, height = (x-tracking)*scale + 2*PADDING, CAP+2*PADDING

        def group(mono=False):
            body = ''.join(f'<path fill="{WHITE if mono else color}" d="{d}" transform="translate({gx:.4f} 0)"/>' for d,gx,color in paths)
            return f'<g transform="translate({PADDING} {PADDING+CAP}) scale({scale:.8f} {-scale:.8f})">{body}</g>'

        color_body, mono_body = group(), group(True)
        assets[key] = (width,height,color_body,mono_body)
        for tail, body in [('',color_body),('-mono',mono_body)]:
            (HERE/f'vrdex-{key}{tail}.svg').write_text(header(width,height,f'VRDex DEX study {key}{tail}')+body+'</svg>\n')
        metadata.append({'key':key,'label':title,'note':note,'suffix':suffix,
                         'viewBox':[0,0,round(width,3),height]})

    def label(value, x, y, size, color=WHITE):
        d, _ = path_for(font,value)
        s = size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    board = [header(1600,1190,'VRDex DEX-only letterform comparison'),
             '<rect width="1600" height="1190" fill="#0B0D12"/>',
             label('VRDEX / DEX studies',56,64,36),
             label('Same open R. Four directions for DEX.',56,103,20,'#98A3B3'),
             label('90 px D height',470,147,16,'#98A3B3'),
             label('140 px color',1110,147,16,'#98A3B3'),
             label('140 px mono',1350,147,16,'#98A3B3')]
    for i, (key,title,note,_) in enumerate(STUDIES):
        y = 168+i*186
        w,h,col,mono = assets[key]
        board += [f'<rect x="40" y="{y}" width="1520" height="166" rx="8" fill="#11161E" stroke="#28313D"/>',
                  label(title,62,y+55,23),label(note,62,y+89,13,'#98A3B3'),
                  f'<g transform="translate(450 {y+17}) scale(.9)">{col}</g>']
        for xpos,body in [(1110,col),(1350,mono)]:
            nh = 140*h/w
            board.append(f'<svg x="{xpos}" y="{y+(166-nh)/2:.3f}" width="140" height="{nh:.3f}" viewBox="0 0 {w:.3f} {h:.3f}">{body}</svg>')
    board += [label('Transparent outlines. Actual SVG-to-PNG renders. Color is constant across all studies.',56,1156,17,'#98A3B3'),'</svg>\n']
    (HERE/'dex-comparison.svg').write_text(''.join(board))
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(FONT.read_bytes()).hexdigest(),
        'vr_color':WHITE,'dex_color':CYAN,'approved_base':'Open upper R, prior study A',
        'studies':metadata},indent=2)+'\n')

    js = r'''
const sharp = require(process.argv[1]);
const fs=require('node:fs'), path=require('node:path'), dir=process.argv[2];
(async()=>{
for(const name of fs.readdirSync(dir).filter(x=>x.startsWith('vrdex-')&&x.endsWith('.svg'))){
 const file=path.join(dir,name), stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 await sharp(file,{density:288}).resize({width:140}).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'dex-comparison.svg')).png().toFile(path.join(dir,'dex-comparison.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg = ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k for k in e.attrib) for e in svg.iter())
    print(HERE/'dex-comparison.png')


if __name__ == '__main__':
    main()

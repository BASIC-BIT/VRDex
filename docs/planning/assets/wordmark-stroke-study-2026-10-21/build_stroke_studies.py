#!/usr/bin/env python3
"""Render five original, self-contained VRDex letterform studies."""
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

# Edits are actual contours, not background-colored cover-up rectangles.
# The first opening joins the R counter to its left edge. Its lower stem and
# diagonal remain; this matches the feature seen in the generated mockup.
UPPER_R = 'M432 584V0H193V782H598Q765 782 840 844Q915 906 915 1028Q915 1152 834 1206Q753 1260 590 1260H193V1462H606Q889 1462 1025 1356Q1161 1250 1161 1036Q1161 763 877 647L1290 0H1018L668 584Z'
LOWER_R = 'M432 782H598Q765 782 840 844Q915 906 915 1028Q915 1152 834 1206Q753 1260 590 1260H432ZM432 584H193V1462H606Q889 1462 1025 1356Q1161 1250 1161 1036Q1161 763 877 647L1290 0H1018L668 584Z'
OPEN_E = 'M1020 0H193V862H983V662H432V203H1020ZM193 1260H1020V1462H193Z'

# The R's rising left stroke now occupies the V's rising arm. It is one shared
# structural stroke, not simply tighter tracking between two untouched glyphs.
SHARED_R = 'M1036 782H1432Q1599 782 1674 844Q1749 906 1749 1028Q1749 1152 1668 1206Q1587 1260 1424 1260H1204ZM966.5 584L762 0H510L1026 1462H1440Q1723 1462 1859 1356Q1995 1250 1995 1036Q1995 763 1711 647L2124 0H1852L1502 584Z'

STUDIES = [
    ('reference', 'Control / Full strokes', 'Current outlined letterforms', None, None),
    ('open-upper-r', 'A / Open upper R', 'Upper-left stem opened; lower stem retained', UPPER_R, None),
    ('open-lower-r', 'B / Open lower R', 'Lower stem removed; bowl remains closed', LOWER_R, None),
    ('matched-r-e', 'C / Matched R + E', 'Matching upper-stem subtraction', UPPER_R, OPEN_E),
    ('shared-vr', 'D / Shared VR stroke', 'V rising arm also forms the R stem', 'shared', None),
]


def path_for(font, text):
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    pen, advance = SVGPathPen(glyphs), 0
    for c in text:
        name = cmap[ord(c)]
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, advance, 0)))
        advance += font['hmtx'].metrics[name][0]
    return pen.getCommands(), advance


def header(w, h, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.3f}" height="{h:.3f}" viewBox="0 0 {w:.3f} {h:.3f}" role="img" aria-label="{html.escape(title)}"><title>{html.escape(title)}</title>'


def main():
    font = TTFont(FONT)
    scale = CAP / font['OS/2'].sCapHeight
    tracking = .8 / scale
    glyphs = {c: path_for(font, c) for c in 'VRDEX'}
    metadata = []
    assets = {}
    for key, label, note, r_edit, e_edit in STUDIES:
        paths, x = [], 0
        if r_edit == 'shared':
            paths.append((glyphs['V'][0] + SHARED_R, 0, WHITE))
            x = 2143 + tracking
        else:
            for c in 'VR':
                paths.append((r_edit if c == 'R' and r_edit else glyphs[c][0], x, WHITE))
                x += glyphs[c][1] + tracking
        for c in 'DEX':
            paths.append((e_edit if c == 'E' and e_edit else glyphs[c][0], x, CYAN))
            x += glyphs[c][1] + tracking
        width, height = (x-tracking)*scale + 2*PADDING, CAP+2*PADDING

        def group(mono=False):
            body=''.join(f'<path fill="{WHITE if mono else color}" d="{d}" transform="translate({gx:.4f} 0)"/>' for d,gx,color in paths)
            return f'<g transform="translate({PADDING} {PADDING+CAP}) scale({scale:.8f} {-scale:.8f})">{body}</g>'

        color_body, mono_body = group(), group(True)
        assets[key]=(width,height,color_body,mono_body)
        for suffix, body in [('',color_body),('-mono',mono_body)]:
            (HERE/f'vrdex-{key}{suffix}.svg').write_text(header(width,height,f'VRDex {key}{suffix}')+body+'</svg>\n')
        metadata.append({'key':key,'label':label,'note':note,'viewBox':[0,0,round(width,3),height]})

    def label(text,x,y,size,color='#EDF3FA'):
        d,_=path_for(font,text)
        s=size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    board=[header(1600,1190,'VRDex stroke and shared-letter comparison'),'<rect width="1600" height="1190" fill="#0B0D12"/>']
    board += [label('VRDEX / Stroke studies',56,64,36),label('Same colors; only the letter construction changes.',56,103,20,'#98A3B3'),label('90 px letter height',470,147,16,'#98A3B3'),label('140 px color',1110,147,16,'#98A3B3'),label('140 px mono',1350,147,16,'#98A3B3')]
    for i,(key,title,note,*_) in enumerate(STUDIES):
        y=168+i*186
        w,h,col,mono=assets[key]
        board += [f'<rect x="40" y="{y}" width="1520" height="166" rx="8" fill="#11161E" stroke="#28313D"/>',label(title,62,y+55,23),label(note,62,y+89,13,'#98A3B3')]
        board.append(f'<g transform="translate(450 {y+17}) scale(.9)">{col}</g>')
        for x,body in [(1110,col),(1350,mono)]:
            nh=140*h/w
            board.append(f'<svg x="{x}" y="{y+(166-nh)/2:.3f}" width="140" height="{nh:.3f}" viewBox="0 0 {w:.3f} {h:.3f}">{body}</svg>')
    board += [label('Transparent SVG geometry, rendered directly to PNG. Open Sans Semibold outline interpretations.',56,1156,17,'#98A3B3'),'</svg>\n']
    (HERE/'stroke-comparison.svg').write_text(''.join(board))
    (HERE/'manifest.json').write_text(json.dumps({'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(FONT.read_bytes()).hexdigest(),'vr_color':WHITE,'dex_color':CYAN,'studies':metadata},indent=2)+'\n')
    js=r'''
const sharp = require(process.argv[1]);
const fs=require('node:fs'), path=require('node:path'), dir=process.argv[2];
(async()=>{
for(const name of fs.readdirSync(dir).filter(x=>x.startsWith('vrdex-')&&x.endsWith('.svg'))){
 const file=path.join(dir,name), stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 await sharp(file,{density:288}).resize({width:140}).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'stroke-comparison.svg')).png().toFile(path.join(dir,'stroke-comparison.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for f in HERE.glob('*.svg'):
        root=ET.parse(f).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use'} for e in root.iter())
        assert all(not any('href' in k for k in e.attrib) for e in root.iter())
    print(HERE/'stroke-comparison.png')


if __name__=='__main__':
    main()

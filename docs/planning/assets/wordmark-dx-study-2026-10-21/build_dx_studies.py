#!/usr/bin/env python3
"""Render a controlled matrix combining the selected D and X cuts."""
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

# Exact approved A R. The V, E and all advances remain untouched.
UPPER_R = 'M432 584V0H193V782H598Q765 782 840 844Q915 906 915 1028Q915 1152 834 1206Q753 1260 590 1260H193V1462H606Q889 1462 1025 1356Q1161 1250 1161 1036Q1161 763 877 647L1290 0H1018L668 584Z'
# Preserve the prior study's selected D path byte-for-byte in the center row.
ORIGINAL_OPEN_D = 'M193 0V1462H645Q994 1462 1188 1274Q1382 1086 1382 745Q1382 527.8 1309.64 371.98L1068.9632 434.4816Q1130 554.76 1130 737Q1130 1262 639 1262H432V201H602Q829.04 201 958.5248 300.1064L1200.5975 211.07625Q1191.05 201.075 1181 191.5Q980 0 602 0Z'

D_ROWS = [('d1', 'D1 / Tight', .8), ('d2', 'D2 / Original', 1.0), ('d3', 'D3 / Wide', 1.2)]
X_COLUMNS = [('x1', 'X1 / Tight', 55), ('x2', 'X2 / Original', 80), ('x3', 'X3 / Wide', 105)]


def path_for(font, text):
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    pen, advance = SVGPathPen(glyphs), 0
    for char in text:
        name = cmap[ord(char)]
        glyphs[name].draw(TransformPen(pen, (1,0,0,1,advance,0)))
        advance += font['hmtx'].metrics[name][0]
    return pen.getCommands(), advance


def lerp(a, b, t):
    return tuple(x+(y-x)*t for x,y in zip(a,b))


def quadratic(a, b, c, t):
    return lerp(lerp(a,b,t),lerp(b,c,t),t)


def point(value):
    return ' '.join(f'{n:.6f}'.rstrip('0').rstrip('.') for n in value)


def open_d_path(factor):
    """Change only cut endpoints, preserving the source quadratic bowl exactly."""
    if factor == 1:
        return ORIGINAL_OPEN_D
    outer = ((1382,745),(1382,383),(1181,191.5))
    inner = ((602,201),(1130,201),(1130,737))
    outer_high, outer_low = .775-.175*factor, .775+.175*factor
    inner_high, inner_low = .545+.115*factor, .545-.115*factor
    # De Casteljau subdivision gives each retained segment its exact control
    # point and endpoint. The break is transparent geometry, never a mask.
    return ''.join([
        'M193 0V1462H645Q994 1462 1188 1274Q1382 1086 1382 745Q',
        point(lerp(outer[0],outer[1],outer_high)), ' ',
        point(quadratic(*outer,outer_high)), 'L',
        point(quadratic(*inner,inner_high)), 'Q',
        point(lerp(inner[1],inner[2],inner_high)), ' 1130 737',
        'Q1130 1262 639 1262H432V201H602Q',
        point(lerp(inner[0],inner[1],inner_low)), ' ',
        point(quadratic(*inner,inner_low)), 'L',
        point(quadratic(*outer,outer_low)), 'Q',
        point(lerp(outer[1],outer[2],outer_low)), ' 1181 191.5',
        'Q980 0 602 0Z',
    ])


def clip_polygon(points, a, b, limit, above):
    result = []
    for previous,current in zip(points[-1:]+points[:-1],points):
        p = a*previous[0]+b*previous[1]-limit
        c = a*current[0]+b*current[1]-limit
        p_inside = p >= 0 if above else p <= 0
        c_inside = c >= 0 if above else c <= 0
        if p_inside != c_inside:
            result.append(lerp(previous,current,p/(p-c)))
        if c_inside:
            result.append(current)
    return result


def polygon_path(points):
    return 'M'+'L'.join(f'{x:.4f} {y:.4f}' for x,y in points)+'Z'


def split_x_path(clearance):
    # Preserve the selected X's continuous descending diagonal exactly. Only
    # the endpoints of its two rising arms move as the clearance changes.
    descending = [(35,1462),(301,1462),(1270,0),(995,0)]
    rising = [(4,0),(260,0),(1235,1462),(977,1462)]
    upper = clip_polygon(rising,1,969/1462,1270+clearance,True)
    lower = clip_polygon(rising,1,960/1462,995-clearance,False)
    return ''.join(polygon_path(p) for p in [descending,upper,lower])


def header(width,height,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.3f}" height="{height:.3f}" viewBox="0 0 {width:.3f} {height:.3f}" role="img" aria-label="{html.escape(title)}"><title>{html.escape(title)}</title>'


def main():
    font = TTFont(FONT)
    scale = CAP/font['OS/2'].sCapHeight
    tracking = .8/scale
    glyphs = {c:path_for(font,c) for c in 'VRDEX'}
    assets, metadata, fixed_paths = {}, [], None
    for dkey,dlabel,d_factor in D_ROWS:
        for xkey,xlabel,x_gap in X_COLUMNS:
            key = f'{dkey}-{xkey}'
            paths, x = [], 0
            for char in 'VRDEX':
                d = {'R':UPPER_R,'D':open_d_path(d_factor),'X':split_x_path(x_gap)}.get(char,glyphs[char][0])
                paths.append((d,x,WHITE if char in 'VR' else CYAN))
                x += glyphs[char][1]+tracking
            preserved = [paths[i] for i in [0,1,3]]
            if fixed_paths is None:
                fixed_paths = preserved
            assert preserved == fixed_paths
            width,height = (x-tracking)*scale+2*PADDING,CAP+2*PADDING
            body = ''.join(f'<path fill="{color}" d="{d}" transform="translate({gx:.4f} 0)"/>' for d,gx,color in paths)
            group = f'<g transform="translate({PADDING} {PADDING+CAP}) scale({scale:.8f} {-scale:.8f})">{body}</g>'
            (HERE/f'vrdex-{key}.svg').write_text(header(width,height,f'VRDex combined D X cuts {dkey} {xkey}')+group+'</svg>\n')
            assets[key] = (width,height,group)
            metadata.append({'key':key,'d_opening_factor':d_factor,'x_clearance_font_units':x_gap,
                             'baseline':key=='d2-x2','viewBox':[0,0,round(width,3),height]})

    def label(value,x,y,size,color=WHITE):
        d,_ = path_for(font,value)
        s = size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    board = [header(1720,1120,'VRDex combined D and X cut refinement matrix'),
             '<rect width="1720" height="1120" fill="#0B0D12"/>',
             label('VRDEX / Combined D + X',48,62,36),
             label('D opening by row. X clearance by column. VR, E and spacing stay fixed.',48,103,20,'#98A3B3')]
    for j,(_,title,_) in enumerate(X_COLUMNS):
        board.append(label(title,190+j*510,165,22))
    for i,(dkey,title,_) in enumerate(D_ROWS):
        row_y = 196+i*288
        board += [label(title.split(' / ')[0],48,row_y+55,27),
                  label(title.split(' / ')[1],48,row_y+84,16,'#98A3B3')]
        for j,(xkey,_,_) in enumerate(X_COLUMNS):
            key = f'{dkey}-{xkey}'
            cell_x = 170+j*510
            w,h,body = assets[key]
            stroke = CYAN if key=='d2-x2' else '#28313D'
            board.append(f'<rect x="{cell_x}" y="{row_y}" width="470" height="264" rx="8" fill="#11161E" stroke="{stroke}" stroke-width="{2 if key=="d2-x2" else 1}"/>')
            board.append(f'<g transform="translate({cell_x+53} {row_y+36}) scale(.76)">{body}</g>')
            nh = 140*h/w
            board.append(f'<svg x="{cell_x+165}" y="{row_y+174}" width="140" height="{nh:.3f}" viewBox="0 0 {w:.3f} {h:.3f}">{body}</svg>')
            if key=='d2-x2':
                board.append(label('Baseline',cell_x+363,row_y+26,15,CYAN))
    board += [label('Every small proof is 140 px wide. Center combines the original D and X cuts.',48,1081,18,'#98A3B3'),'</svg>\n']
    (HERE/'dx-comparison.svg').write_text(''.join(board))
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(FONT.read_bytes()).hexdigest(),
        'vr_color':WHITE,'dex_color':CYAN,'baseline':'d2-x2',
        'd_rows':{'d1':.8,'d2':1,'d3':1.2},'x_columns':{'x1':55,'x2':80,'x3':105},
        'd_outer_parameter_center':.775,'d_outer_parameter_half_width':.175,
        'd_inner_parameter_center':.545,'d_inner_parameter_half_width':.115,
        'studies':metadata},indent=2)+'\n')

    js = r'''
const sharp = require(process.argv[1]);
const fs=require('node:fs'),path=require('node:path'),dir=process.argv[2];
(async()=>{
for(const name of fs.readdirSync(dir).filter(x=>x.startsWith('vrdex-')&&x.endsWith('.svg'))){
 const file=path.join(dir,name),stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 await sharp(file,{density:288}).resize({width:140}).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'dx-comparison.svg')).png().toFile(path.join(dir,'dx-comparison.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg = ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k or 'url(' in v for k,v in e.attrib.items()) for e in svg.iter())
    print(HERE/'dx-comparison.png')


if __name__ == '__main__':
    main()

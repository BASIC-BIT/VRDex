#!/usr/bin/env python3
"""Compare spacing while preserving every selected wordmark contour."""
from pathlib import Path
import hashlib
import html
import importlib.util
import json
import math
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

from fontTools.pens.boundsPen import BoundsPen
from fontTools.svgLib.path import parse_path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = HERE.parent/'wordmark-matched-gaps-2026-10-21/vrdex-wordmark.svg'
HELPERS = HERE.parent/'wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('wordmark_geometry',HELPERS)
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)

# Pair order: V/R, R/D, D/E, E/X. Values are deltas from the current font
# advances plus 0.8px tracking, measured at the original 100px cap height.
STUDIES = [
    ('tight','Tight','-4 px per pair',[-4,-4,-4,-4]),
    ('slightly-tighter','Slightly tighter','-2 px per pair',[-2,-2,-2,-2]),
    ('current','Current','Reference / 0 px per pair',[0,0,0,0]),
    ('open','Open','+3 px per pair',[3,3,3,3]),
    ('optical','Optical VR + DEX','0 / +4 / -5 / +2 px',[0,4,-5,2]),
]
SMALL_SCALE = .29


def main():
    ns = {'s':'http://www.w3.org/2000/svg'}
    source = ET.parse(SOURCE).getroot()
    original_group = source.find('s:g',ns)
    original = [dict(e.attrib) for e in original_group.findall('s:path',ns)]
    assert len(original)==5
    scale = float(re.search(r'scale\(([^ ]+)',original_group.attrib['transform']).group(1))
    base_width,height = float(source.attrib['width']),float(source.attrib['height'])
    positions = [float(re.search(r'translate\(([^ ]+)',e['transform']).group(1)) for e in original]
    bounds = []
    for path in original:
        pen = BoundsPen(None)
        parse_path(path['d'],pen)
        bounds.append(pen.bounds)
    assets,metadata = {},[]
    for key,title,note,deltas in STUDIES:
        cumulative = [0]
        for delta in deltas:
            cumulative.append(cumulative[-1]+delta)
        new_positions = [x+delta/scale for x,delta in zip(positions,cumulative)]
        paths = [dict(e) for e in original]
        for i,path in enumerate(paths):
            if cumulative[i]:
                path['transform'] = f'translate({new_positions[i]:.8f} 0)'
        width = base_width+cumulative[-1]
        gaps = [(new_positions[i+1]+bounds[i+1][0]-new_positions[i]-bounds[i][2])*scale for i in range(4)]
        assert min(gaps)>0
        outlines = ''.join('<path '+' '.join(f'{k}="{html.escape(v,quote=True)}"' for k,v in path.items())+'/>' for path in paths)
        body = f'<g transform="{original_group.attrib["transform"]}">{outlines}</g>'
        (HERE/f'vrdex-{key}.svg').write_text(geometry.header(width,height,f'VRDex {title} spacing')+body+'</svg>\n')
        assets[key] = (width,body)
        metadata.append({'key':key,'title':title,'pair_delta_px_at_100_cap':deltas,
                         'cumulative_x_delta_px_at_100_cap':cumulative,
                         'ink_bbox_gaps_px_at_100_cap':gaps,
                         'viewBox':[0,0,width,height],
                         'navbar_cap_height_px':29,
                         'navbar_content_width_px':width*SMALL_SCALE,
                         'navbar_canvas_width_px':math.ceil(width*SMALL_SCALE)})

    font = geometry.TTFont(geometry.FONT)
    def label(value,x,y,size,color=geometry.WHITE):
        d,_ = geometry.path_for(font,value)
        s = size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    board = [geometry.header(1450,1120,'VRDex spacing study at fixed cap heights'),
             '<rect width="1450" height="1120" fill="#0B0D12"/>',
             label('VRDEX / Letter spacing',48,62,36),
             label('Same letterforms. Shared cap heights, so widths can change.',48,103,20,'#98A3B3'),
             label('100 px cap height',400,155,17,'#98A3B3'),
             label('29 px cap height',1050,155,17,'#98A3B3'),
             label('Width',1260,155,17,'#98A3B3')]
    for i,(key,title,note,_) in enumerate(STUDIES):
        y = 180+i*178
        width,body = assets[key]
        current = key=='current'
        board += [f'<rect x="32" y="{y}" width="1386" height="160" rx="8" fill="#11161E" stroke="{geometry.CYAN if current else "#28313D"}" stroke-width="{2 if current else 1}"/>',
                  label(title,54,y+61,24),label(note,54,y+96,14,'#98A3B3'),
                  f'<g transform="translate(380 {y+14})">{body}</g>',
                  f'<g transform="translate(1050 {y+60}) scale({SMALL_SCALE})">{body}</g>',
                  label(f'{width*SMALL_SCALE:.1f} px',1260,y+86,19,geometry.CYAN if current else geometry.WHITE)]
    maximum = max(w*SMALL_SCALE for w,_ in assets.values())
    board += [label(f'Small cap height stays 29 px. Widest option: {maximum:.1f} px. Spacing deltas refer to V/R, R/D, D/E, E/X.',48,1094,16,'#98A3B3'),'</svg>\n']
    (HERE/'spacing-comparison.svg').write_text(''.join(board))
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(geometry.FONT.read_bytes()).hexdigest(),
        'source_wordmark':'../wordmark-matched-gaps-2026-10-21/vrdex-wordmark.svg',
        'source_wordmark_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'geometry_helper':'../wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py',
        'geometry_helper_sha256':hashlib.sha256(HELPERS.read_bytes()).hexdigest(),
        'pair_order':['V/R','R/D','D/E','E/X'],
        'vr_color':geometry.WHITE,'dex_color':geometry.CYAN,
        'large_cap_height_px':100,'small_cap_height_px':29,
        'small_canvas_height_px':math.ceil(height*SMALL_SCALE),
        'studies':metadata},indent=2)+'\n')

    js = r'''
const sharp=require(process.argv[1]);
const fs=require('node:fs'),path=require('node:path'),dir=process.argv[2];
(async()=>{
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
for(const study of manifest.studies){
 const stem='vrdex-'+study.key,file=path.join(dir,stem+'.svg');
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 const text=fs.readFileSync(file,'utf8'),inner=text.slice(text.indexOf('>')+1,text.lastIndexOf('</svg>'));
 const w=study.navbar_canvas_width_px,h=manifest.small_canvas_height_px;
 const small=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="scale(.29)">${inner}</g></svg>`;
 await sharp(Buffer.from(small)).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'spacing-comparison.svg')).png().toFile(path.join(dir,'spacing-comparison.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg = ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k or 'url(' in v for k,v in e.attrib.items()) for e in svg.iter())
    print(HERE/'spacing-comparison.png')


if __name__=='__main__':
    main()

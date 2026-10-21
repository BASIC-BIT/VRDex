#!/usr/bin/env python3
"""Export the selected 45-degree wordmark with an 8% wider D slit."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
HELPERS = HERE.parent/'wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('d_angle_geometry',HELPERS)
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def main():
    font = geometry.TTFont(geometry.FONT)
    scale = geometry.CAP/font['OS/2'].sCapHeight
    tracking = .8/scale
    glyphs = {c:geometry.path_for(font,c) for c in 'VRDEX'}
    anchor,old_width,_ = geometry.control_measurement()
    refined_width = old_width*1.08
    before_d,_ = geometry.angled_d_path(45,anchor,old_width)
    refined_d,measurements = geometry.angled_d_path(45,anchor,refined_width)

    def wordmark(d,mono=False):
        x,paths = 0,[]
        for char in 'VRDEX':
            outline = {'R':geometry.UPPER_R,'D':d,'X':geometry.split_x_path()}.get(char,glyphs[char][0])
            color = geometry.WHITE if mono or char in 'VR' else geometry.CYAN
            paths.append(f'<path fill="{color}" d="{outline}" transform="translate({x:.4f} 0)"/>')
            x += glyphs[char][1]+tracking
        width,height = (x-tracking)*scale+2*geometry.PADDING,geometry.CAP+2*geometry.PADDING
        body = f'<g transform="translate({geometry.PADDING} {geometry.PADDING+geometry.CAP}) scale({scale:.8f} {-scale:.8f})">'+''.join(paths)+'</g>'
        return width,height,body

    width,height,refined = wordmark(refined_d)
    _,_,mono = wordmark(refined_d,True)
    _,_,before = wordmark(before_d)
    for tail,body in [('',refined),('-mono',mono)]:
        (HERE/f'vrdex-wordmark{tail}.svg').write_text(geometry.header(width,height,'VRDex selected 45-degree refined wordmark')+body+'</svg>\n')

    def label(value,x,y,size,color=geometry.WHITE):
        d,_ = geometry.path_for(font,value)
        s = size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    proof = [geometry.header(1200,560,'VRDex selected 45-degree cut before and after refinement'),
             '<rect width="1200" height="560" fill="#0B0D12"/>',
             label('VRDEX / 45° refinement',40,60,34),
             label('Same angle and anchor. A slightly wider D cut.',40,99,20,'#98A3B3'),
             label('90 px D height',340,143,16,'#98A3B3'),
             label('140 px',980,143,16,'#98A3B3')]
    for y,title,note,body in [(164,'Before / 45°','Original cut width',before),(346,'Refined / 45°','8% wider cut',refined)]:
        proof += [f'<rect x="28" y="{y}" width="1144" height="154" rx="8" fill="#11161E" stroke="#28313D"/>',
                  label(title,48,y+63,23),label(note,48,y+94,15,'#98A3B3'),
                  f'<g transform="translate(300 {y+13}) scale(.9)">{body}</g>',
                  f'<svg x="980" y="{y+57}" width="140" height="{140*height/width:.3f}" viewBox="0 0 {width:.3f} {height:.3f}">{body}</svg>']
    proof += [label('All other letterforms, spacing and colors stay fixed.',40,538,17,'#98A3B3'),'</svg>\n']
    (HERE/'refinement-proof.svg').write_text(''.join(proof))
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10',
        'font_sha256':hashlib.sha256(geometry.FONT.read_bytes()).hexdigest(),
        'geometry_helper':'../wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py',
        'geometry_helper_sha256':hashlib.sha256(HELPERS.read_bytes()).hexdigest(),
        'vr_color':geometry.WHITE,'dex_color':geometry.CYAN,
        'angle_degrees_down_right':45,'width_multiplier':1.08,
        'previous_normal_width_font_units':old_width,
        'refined_normal_width_font_units':refined_width,
        'anchor_font_coordinates':anchor,'viewBox':[0,0,round(width,3),height],
        'intersections':measurements},indent=2)+'\n')

    js = r'''
const sharp=require(process.argv[1]);
const fs=require('node:fs'),path=require('node:path'),dir=process.argv[2];
(async()=>{
for(const name of ['vrdex-wordmark.svg','vrdex-wordmark-mono.svg']){
 const file=path.join(dir,name),stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 await sharp(file,{density:288}).resize({width:140}).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'refinement-proof.svg')).png().toFile(path.join(dir,'refinement-proof.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg = ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k or 'url(' in v for k,v in e.attrib.items()) for e in svg.iter())
    print(HERE/'refinement-proof.png')


if __name__=='__main__':
    main()

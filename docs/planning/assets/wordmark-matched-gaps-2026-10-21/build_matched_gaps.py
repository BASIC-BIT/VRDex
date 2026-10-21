#!/usr/bin/env python3
"""Match the X's two normal gaps to the selected D's normal gap."""
from pathlib import Path
import hashlib
import html
import importlib.util
import json
import math
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = HERE.parent/'wordmark-refined-2026-10-21/vrdex-wordmark.svg'
SOURCE_MANIFEST = SOURCE.parent/'manifest.json'
HELPERS = HERE.parent/'wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('wordmark_geometry',HELPERS)
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def main():
    namespace = {'s':'http://www.w3.org/2000/svg'}
    source = ET.parse(SOURCE).getroot()
    source_group = source.find('s:g',namespace)
    before_paths = [dict(p.attrib) for p in source_group.findall('s:path',namespace)]
    assert len(before_paths)==5
    target = json.loads(SOURCE_MANIFEST.read_text())['refined_normal_width_font_units']
    top_a,bottom_a = 969/1462,960/1462
    top_clearance = target*math.sqrt(1+top_a*top_a)
    bottom_clearance = target*math.sqrt(1+bottom_a*bottom_a)
    rising = [(4,0),(260,0),(1235,1462),(977,1462)]
    upper = geometry.clip_polygon(rising,1,top_a,1270+top_clearance,True)
    lower = geometry.clip_polygon(rising,1,bottom_a,995-bottom_clearance,False)
    # Keep the continuous descending stroke byte-for-byte. Only the two
    # rising-arm polygons receive new cut endpoints.
    descending = before_paths[4]['d'].split('Z')[0]+'Z'
    arm_paths = ''.join('M'+'L'.join(f'{x:.8f} {y:.8f}' for x,y in p)+'Z' for p in [upper,lower])
    after_paths = [dict(p) for p in before_paths]
    after_paths[4]['d'] = descending+arm_paths

    def group(paths,mono=False):
        outlines=[]
        for path in paths:
            attrs=dict(path)
            if mono:
                attrs['fill']=geometry.WHITE
            outlines.append('<path '+' '.join(f'{k}="{html.escape(v,quote=True)}"' for k,v in attrs.items())+'/>')
        return f'<g transform="{source_group.attrib["transform"]}">'+''.join(outlines)+'</g>'

    width,height = float(source.attrib['width']),float(source.attrib['height'])
    before,after = group(before_paths),group(after_paths)
    for tail,body in [('',after),('-mono',group(after_paths,True))]:
        (HERE/f'vrdex-wordmark{tail}.svg').write_text(geometry.header(width,height,'VRDex selected wordmark with matching D and X gaps')+body+'</svg>\n')

    font = geometry.TTFont(geometry.FONT)
    def label(value,x,y,size,color=geometry.WHITE):
        d,_ = geometry.path_for(font,value)
        scale = size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({scale:.8f} {-scale:.8f})"/>'

    proof = [geometry.header(1200,560,'VRDex matching D and X gaps before and after'),
             '<rect width="1200" height="560" fill="#0B0D12"/>',
             label('VRDEX / Matched gaps',40,60,34),
             label('Both X cuts now match the D cut in perpendicular width.',40,99,20,'#98A3B3'),
             label('90 px D height',340,143,16,'#98A3B3'),
             label('140 px',980,143,16,'#98A3B3')]
    for y,title,note,body in [(164,'Before','Narrower X gaps',before),(346,'Matched gaps','Same D and X gap widths',after)]:
        proof += [f'<rect x="28" y="{y}" width="1144" height="154" rx="8" fill="#11161E" stroke="#28313D"/>',
                  label(title,48,y+63,23),label(note,48,y+94,14,'#98A3B3'),
                  f'<g transform="translate(300 {y+13}) scale(.9)">{body}</g>',
                  f'<svg x="980" y="{y+57}" width="140" height="{140*height/width:.3f}" viewBox="0 0 {width:.3f} {height:.3f}">{body}</svg>']
    proof += [label('Selected D, V/R/E, descending X stroke, spacing and colors stay fixed.',40,538,16,'#98A3B3'),'</svg>\n']
    (HERE/'matched-gaps-proof.svg').write_text(''.join(proof))
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(geometry.FONT.read_bytes()).hexdigest(),
        'source_wordmark':'../wordmark-refined-2026-10-21/vrdex-wordmark.svg',
        'source_wordmark_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'geometry_helper':'../wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py',
        'geometry_helper_sha256':hashlib.sha256(HELPERS.read_bytes()).hexdigest(),
        'vr_color':geometry.WHITE,'dex_color':geometry.CYAN,
        'd_angle_degrees_down_right':45,'normal_gap_font_units':target,
        'x_upper':{'edge_a':top_a,'edge_b':1270,'previous_projection_clearance':80,
                   'projection_clearance':top_clearance,'normal_gap_font_units':top_clearance/math.sqrt(1+top_a*top_a)},
        'x_lower':{'edge_a':bottom_a,'edge_b':995,'previous_projection_clearance':80,
                   'projection_clearance':bottom_clearance,'normal_gap_font_units':bottom_clearance/math.sqrt(1+bottom_a*bottom_a)},
        'viewBox':[0,0,width,height]},indent=2)+'\n')

    js = r'''
const sharp=require(process.argv[1]);
const path=require('node:path'),dir=process.argv[2];
(async()=>{
for(const name of ['vrdex-wordmark.svg','vrdex-wordmark-mono.svg']){
 const file=path.join(dir,name),stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 await sharp(file,{density:288}).resize({width:140}).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'matched-gaps-proof.svg')).png().toFile(path.join(dir,'matched-gaps-proof.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg=ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k or 'url(' in v for k,v in e.attrib.items()) for e in svg.iter())
    print(HERE/'matched-gaps-proof.png')


if __name__=='__main__':
    main()

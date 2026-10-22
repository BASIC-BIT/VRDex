#!/usr/bin/env python3
"""Keep the selected slightly tighter spacing, reducing only D/E by 3px."""
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

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = HERE.parent/'wordmark-spacing-study-2026-10-21/vrdex-slightly-tighter.svg'
HELPERS = HERE.parent/'wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('wordmark_geometry',HELPERS)
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def main():
    ns = {'s':'http://www.w3.org/2000/svg'}
    source = ET.parse(SOURCE).getroot()
    source_group = source.find('s:g',ns)
    before_paths = [dict(p.attrib) for p in source_group.findall('s:path',ns)]
    assert len(before_paths)==5
    scale = float(re.search(r'scale\(([^ ]+)',source_group.attrib['transform']).group(1))
    after_paths = [dict(p) for p in before_paths]
    for index in [3,4]:
        x,y = re.search(r'translate\(([^)]+)',before_paths[index]['transform']).group(1).split()
        after_paths[index]['transform'] = f'translate({float(x)-3/scale:.8f} {y})'
    before_width,height = float(source.attrib['width']),float(source.attrib['height'])
    width = before_width-3

    def group(paths,mono=False):
        outlines=[]
        for path in paths:
            attrs=dict(path)
            if mono:
                attrs['fill']=geometry.WHITE
            outlines.append('<path '+' '.join(f'{k}="{html.escape(v,quote=True)}"' for k,v in attrs.items())+'/>')
        return f'<g transform="{source_group.attrib["transform"]}">'+''.join(outlines)+'</g>'

    before,after = group(before_paths),group(after_paths)
    for tail,body in [('',after),('-mono',group(after_paths,True))]:
        (HERE/f'vrdex-wordmark{tail}.svg').write_text(geometry.header(width,height,'VRDex selected spacing with closer D and E')+body+'</svg>\n')
    font = geometry.TTFont(geometry.FONT)
    def label(value,x,y,size,color=geometry.WHITE):
        d,_ = geometry.path_for(font,value)
        s = size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    proof = [geometry.header(1200,560,'VRDex selected spacing before and after closer D E'),
             '<rect width="1200" height="560" fill="#0B0D12"/>',
             label('VRDEX / Closer D + E',40,60,34),
             label('Selected spacing. D/E moves closer; all other gaps stay fixed.',40,99,19,'#98A3B3'),
             label('90 px cap height',340,143,16,'#98A3B3'),
             label('29 px cap height',970,143,16,'#98A3B3')]
    for y,title,note,body,w in [(164,'Before','Selected slightly tighter',before,before_width),(346,'Refined','D/E reduced by 3 px',after,width)]:
        proof += [f'<rect x="28" y="{y}" width="1144" height="154" rx="8" fill="#11161E" stroke="#28313D"/>',
                  label(title,48,y+63,23),label(note,48,y+94,14,'#98A3B3'),
                  f'<g transform="translate(300 {y+13}) scale(.9)">{body}</g>',
                  f'<g transform="translate(970 {y+57}) scale(.29)">{body}</g>',
                  label(f'{w*.29:.1f} px wide',970,y+121,13,'#98A3B3')]
    proof += [label('All contours, cuts and colors stay exact. E and X move together, preserving E/X spacing.',40,538,15,'#98A3B3'),'</svg>\n']
    (HERE/'spacing-refinement-proof.svg').write_text(''.join(proof))
    source_manifest = json.loads((SOURCE.parent/'manifest.json').read_text())
    gaps = next(s['ink_bbox_gaps_px_at_100_cap'] for s in source_manifest['studies'] if s['key']=='slightly-tighter')
    refined_gaps = gaps.copy()
    refined_gaps[2]-=3
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(geometry.FONT.read_bytes()).hexdigest(),
        'source_wordmark':'../wordmark-spacing-study-2026-10-21/vrdex-slightly-tighter.svg',
        'source_wordmark_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'geometry_helper':'../wordmark-d-angle-study-2026-10-21/build_d_angle_studies.py',
        'geometry_helper_sha256':hashlib.sha256(HELPERS.read_bytes()).hexdigest(),
        'vr_color':geometry.WHITE,'dex_color':geometry.CYAN,
        'additional_pair_delta_px_at_100_cap':[0,0,-3,0],
        'additional_glyph_x_delta_px_at_100_cap':[0,0,0,-3,-3],
        'before_ink_bbox_gaps_px_at_100_cap':gaps,
        'refined_ink_bbox_gaps_px_at_100_cap':refined_gaps,
        'viewBox':[0,0,width,height],
        'large_proof_cap_height_px':90,'small_cap_height_px':29,
        'before_small_content_width_px':before_width*.29,
        'small_content_width_px':width*.29,
        'small_canvas_width_px':math.ceil(width*.29),'small_canvas_height_px':math.ceil(height*.29)},indent=2)+'\n')

    js = r'''
const sharp=require(process.argv[1]);
const fs=require('node:fs'),path=require('node:path'),dir=process.argv[2];
(async()=>{
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
for(const name of ['vrdex-wordmark.svg','vrdex-wordmark-mono.svg']){
 const file=path.join(dir,name),stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 const text=fs.readFileSync(file,'utf8'),inner=text.slice(text.indexOf('>')+1,text.lastIndexOf('</svg>'));
 const w=manifest.small_canvas_width_px,h=manifest.small_canvas_height_px;
 const small=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="scale(.29)">${inner}</g></svg>`;
 await sharp(Buffer.from(small)).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'spacing-refinement-proof.svg')).png().toFile(path.join(dir,'spacing-refinement-proof.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg = ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k or 'url(' in v for k,v in e.attrib.items()) for e in svg.iter())
    print(HERE/'spacing-refinement-proof.png')


if __name__=='__main__':
    main()

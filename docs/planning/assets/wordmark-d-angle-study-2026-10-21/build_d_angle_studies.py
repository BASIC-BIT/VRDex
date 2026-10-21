#!/usr/bin/env python3
"""Rotate a fixed-width transparent D slit against native quadratic curves."""
from pathlib import Path
import hashlib
import html
import json
import math
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
UPPER_R = 'M432 584V0H193V782H598Q765 782 840 844Q915 906 915 1028Q915 1152 834 1206Q753 1260 590 1260H193V1462H606Q889 1462 1025 1356Q1161 1250 1161 1036Q1161 763 877 647L1290 0H1018L668 584Z'
CONTROL_D = 'M193 0V1462H645Q994 1462 1188 1274Q1382 1086 1382 745Q1382 515.13 1300.951775 354.009862L1060.425968 418.492184Q1130 542.432 1130 737Q1130 1262 639 1262H432V201H602Q841.184 201 972.017648 310.992024L1213.717775 225.286862Q1198.085 207.7775 1181 191.5Q980 0 602 0Z'

OUTER = [
    ((645,1462),(994,1462),(1188,1274)),
    ((1188,1274),(1382,1086),(1382,745)),
    ((1382,745),(1382,383),(1181,191.5)),
    ((1181,191.5),(980,0),(602,0)),
]
INNER = ((602,201),(1130,201),(1130,737))
ANGLES = [25,35,45,57]


def lerp(a,b,t):
    return tuple(x+(y-x)*t for x,y in zip(a,b))


def quadratic(curve,t):
    a,b,c = curve
    return lerp(lerp(a,b,t),lerp(b,c,t),t)


def dot(a,b):
    return sum(x*y for x,y in zip(a,b))


def point(p):
    return ' '.join(f'{x:.8f}'.rstrip('0').rstrip('.') for x in p)


def control_measurement():
    # D1's faces are not parallel. Measure its average direction and the
    # separation of face midpoints along that direction's unit normal.
    oh,ol = quadratic(OUTER[2],.635),quadratic(OUTER[2],.915)
    ih,il = quadratic(INNER,.637),quadratic(INNER,.453)
    outer_center,inner_center = lerp(oh,ol,.5),lerp(ih,il,.5)
    face_high,face_low = lerp(oh,ih,.5),lerp(ol,il,.5)
    theta = math.atan2(inner_center[1]-outer_center[1],outer_center[0]-inner_center[0])
    normal = (math.sin(theta),math.cos(theta))
    width = abs(dot(tuple(x-y for x,y in zip(face_high,face_low)),normal))
    return lerp(face_high,face_low,.5),width,math.degrees(theta)


def intersection(curves,normal,offset):
    roots = []
    for index,(a,b,c) in enumerate(curves):
        aa = dot(normal,tuple(x-2*y+z for x,y,z in zip(a,b,c)))
        bb = 2*dot(normal,tuple(y-x for x,y in zip(a,b)))
        cc = dot(normal,a)-offset
        if abs(aa)<1e-12:
            candidates = [-cc/bb] if abs(bb)>1e-12 else []
        else:
            discriminant = bb*bb-4*aa*cc
            candidates = [] if discriminant<0 else [(-bb+math.sqrt(discriminant))/(2*aa),(-bb-math.sqrt(discriminant))/(2*aa)]
        for t in candidates:
            if 0<t<1:
                p = quadratic((a,b,c),t)
                assert abs(dot(normal,p)-offset)<1e-7
                roots.append((index,t,p))
    assert len(roots)==1,roots
    return roots[0]


def before(curves,index,t):
    commands = []
    for i,curve in enumerate(curves[:index+1]):
        control = curve[1] if i<index else lerp(curve[0],curve[1],t)
        end = curve[2] if i<index else quadratic(curve,t)
        commands.append('Q'+point(control)+' '+point(end))
    return ''.join(commands)


def after(curves,index,t):
    commands = []
    for i in range(index,len(curves)):
        curve = curves[i]
        control = lerp(curve[1],curve[2],t) if i==index else curve[1]
        commands.append('Q'+point(control)+' '+point(curve[2]))
    return ''.join(commands)


def angled_d_path(degrees,anchor,width):
    theta = math.radians(degrees)
    normal = (math.sin(theta),math.cos(theta))
    center = dot(normal,anchor)
    outer_high = intersection(OUTER,normal,center+width/2)
    outer_low = intersection(OUTER,normal,center-width/2)
    _,inner_high_t,inner_high = intersection([INNER],normal,center+width/2)
    _,inner_low_t,inner_low = intersection([INNER],normal,center-width/2)
    assert inner_low_t<inner_high_t
    d = ''.join([
        'M193 0V1462H645',before(OUTER,outer_high[0],outer_high[1]),
        'L',point(inner_high),'Q',point(lerp(INNER[1],INNER[2],inner_high_t)),' 1130 737',
        'Q1130 1262 639 1262H432V201H602Q',
        point(lerp(INNER[0],INNER[1],inner_low_t)),' ',point(inner_low),
        'L',point(outer_low[2]),after(OUTER,outer_low[0],outer_low[1]),'H193Z',
    ])
    meta = {'angle_degrees_down_right':degrees,'normal_width_font_units':width,
            'outer_high':{'curve':outer_high[0],'t':outer_high[1],'point':outer_high[2]},
            'outer_low':{'curve':outer_low[0],'t':outer_low[1],'point':outer_low[2]},
            'inner_high':{'t':inner_high_t,'point':inner_high},
            'inner_low':{'t':inner_low_t,'point':inner_low}}
    return d,meta


def clip_polygon(points,a,b,limit,above):
    result=[]
    for previous,current in zip(points[-1:]+points[:-1],points):
        p,c=a*previous[0]+b*previous[1]-limit,a*current[0]+b*current[1]-limit
        p_inside,c_inside=(p>=0,c>=0) if above else (p<=0,c<=0)
        if p_inside!=c_inside:
            result.append(lerp(previous,current,p/(p-c)))
        if c_inside:
            result.append(current)
    return result


def split_x_path():
    descending=[(35,1462),(301,1462),(1270,0),(995,0)]
    rising=[(4,0),(260,0),(1235,1462),(977,1462)]
    polygons=[descending,clip_polygon(rising,1,969/1462,1350,True),clip_polygon(rising,1,960/1462,915,False)]
    return ''.join('M'+'L'.join(f'{x:.4f} {y:.4f}' for x,y in p)+'Z' for p in polygons)


def path_for(font,text):
    glyphs,cmap=font.getGlyphSet(),font.getBestCmap()
    pen,advance=SVGPathPen(glyphs),0
    for char in text:
        name=cmap[ord(char)]
        glyphs[name].draw(TransformPen(pen,(1,0,0,1,advance,0)))
        advance+=font['hmtx'].metrics[name][0]
    return pen.getCommands(),advance


def header(w,h,title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.3f}" height="{h:.3f}" viewBox="0 0 {w:.3f} {h:.3f}" role="img" aria-label="{html.escape(title)}"><title>{html.escape(title)}</title>'


def main():
    font=TTFont(FONT)
    scale=CAP/font['OS/2'].sCapHeight
    tracking=.8/scale
    glyphs={c:path_for(font,c) for c in 'VRDEX'}
    anchor,normal_width,control_angle=control_measurement()
    studies=[('control','Current D1','About 17° overall',CONTROL_D,{'average_angle_degrees':control_angle})]
    for angle in ANGLES:
        d,meta=angled_d_path(angle,anchor,normal_width)
        note='Follows the R / X direction' if angle==57 else 'Parallel cut faces'
        studies.append((f'angle-{angle}',f'{angle}° down-right',note,d,meta))
    assets,metadata={},[]
    for key,title,note,d,meta in studies:
        x,paths=0,[]
        for char in 'VRDEX':
            outline={'R':UPPER_R,'D':d,'X':split_x_path()}.get(char,glyphs[char][0])
            paths.append(f'<path fill="{WHITE if char in "VR" else CYAN}" d="{outline}" transform="translate({x:.4f} 0)"/>')
            x+=glyphs[char][1]+tracking
        w,h=(x-tracking)*scale+2*PADDING,CAP+2*PADDING
        body=f'<g transform="translate({PADDING} {PADDING+CAP}) scale({scale:.8f} {-scale:.8f})">'+''.join(paths)+'</g>'
        (HERE/f'vrdex-{key}.svg').write_text(header(w,h,f'VRDex D cut {title}')+body+'</svg>\n')
        assets[key]=(w,h,body)
        metadata.append({'key':key,'title':title,'viewBox':[0,0,round(w,3),h],**meta})

    def label(value,x,y,size,color=WHITE):
        d,_=path_for(font,value)
        s=size/font['head'].unitsPerEm
        return f'<path fill="{color}" d="{d}" transform="translate({x} {y}) scale({s:.8f} {-s:.8f})"/>'

    board=[header(1600,1260,'VRDex downward D cut angle comparison'),
           '<rect width="1600" height="1260" fill="#0B0D12"/>',
           label('VRDEX / D cut angle',48,64,36),
           label('A steeper downward cut. New angles share one anchor and perpendicular width.',48,105,20,'#98A3B3'),
           label('Enlarged cut',330,159,17,'#98A3B3'),
           label('Full wordmark',670,159,17,'#98A3B3'),
           label('140 px',1305,159,17,'#98A3B3')]
    for i,(key,title,note,d,_) in enumerate(studies):
        y=185+i*196
        w,h,body=assets[key]
        board += [f'<rect x="40" y="{y}" width="1520" height="176" rx="8" fill="#11161E" stroke="#28313D"/>',
                  label(title,62,y+66,25),label(note,62,y+98,14,'#98A3B3'),
                  f'<svg x="330" y="{y+8}" width="180" height="160" viewBox="840 865 640 570"><path fill="{CYAN}" d="{d}" transform="translate(0 1462) scale(1 -1)"/></svg>',
                  f'<g transform="translate(650 {y+27}) scale(.85)">{body}</g>',
                  f'<svg x="1305" y="{y+68}" width="140" height="{140*h/w:.3f}" viewBox="0 0 {w:.3f} {h:.3f}">{body}</svg>']
    board += [label('VR, E, original split X and spacing stay fixed. Cut angles slope down to the right on screen.',48,1217,18,'#98A3B3'),'</svg>\n']
    (HERE/'d-angle-comparison.svg').write_text(''.join(board))
    (HERE/'manifest.json').write_text(json.dumps({
        'font':'Open Sans Semibold 1.10','font_sha256':hashlib.sha256(FONT.read_bytes()).hexdigest(),
        'vr_color':WHITE,'dex_color':CYAN,'anchor_font_coordinates':anchor,
        'new_slit_normal_width_font_units':normal_width,'control_average_angle_degrees':control_angle,
        'outer_source_quadratics':OUTER,'inner_source_quadratic':INNER,'studies':metadata},indent=2)+'\n')
    js=r'''
const sharp=require(process.argv[1]);
const fs=require('node:fs'),path=require('node:path'),dir=process.argv[2];
(async()=>{
for(const name of fs.readdirSync(dir).filter(x=>x.startsWith('vrdex-')&&x.endsWith('.svg'))){
 const file=path.join(dir,name),stem=name.slice(0,-4);
 await sharp(file,{density:288}).resize({width:900}).png().toFile(path.join(dir,stem+'.png'));
 await sharp(file,{density:288}).resize({width:140}).png().toFile(path.join(dir,stem+'-navbar.png'));
}
await sharp(path.join(dir,'d-angle-comparison.svg')).png().toFile(path.join(dir,'d-angle-comparison.png'));
})().catch(e=>{console.error(e);process.exit(1)});
'''
    subprocess.run(['node','-e',js,str(ROOT/'apps/web/node_modules/sharp'),str(HERE)],check=True)
    for asset in HERE.glob('*.svg'):
        svg=ET.parse(asset).getroot()
        assert all(e.tag.rsplit('}',1)[-1] not in {'text','image','script','foreignObject','use','mask'} for e in svg.iter())
        assert all(not any('href' in k or 'url(' in v for k,v in e.attrib.items()) for e in svg.iter())
    print(HERE/'d-angle-comparison.png')


if __name__=='__main__':
    main()

/** Frozen YUV source/flash ROIs. Fresh canvas; no rawvideo file is written. */
export function markerFrame(width,height,identity,flash,slot=0) {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<4||height<4||width%2||height%2||!['a','b','slate'].includes(identity)||!Number.isSafeInteger(slot)||slot<0)throw Error('qualification_frame');
 const size=width*height,frame=Buffer.alloc(size*3/2,128);frame.fill(16,0,size);
 const rectangle=(left,right,values)=>{
  const x0=Math.floor(left*width/1920),x1=Math.floor(right*width/1920),y1=Math.floor(128*height/1080);
  for(let y=0;y<y1;y++)frame.fill(values[0],y*width+x0,y*width+x1);
  for(let y=0;y<Math.ceil(y1/2);y++)for(const [index,value] of values.slice(1).entries())frame.fill(value,size+index*size/4+y*width/2+Math.floor(x0/2),size+index*size/4+y*width/2+Math.ceil(x1/2));
 };
 rectangle(0,128,identity==='a'?[81,90,240]:identity==='b'?[41,240,110]:[16,128,128]);rectangle(128,256,flash?[235,128,128]:[16,128,128]);
 // Stable visible slot ordinal outside both independently sampled ROIs.
 for(let bit=0;bit<8;bit++)if(slot&(1<<bit))for(let y=height-8;y<height;y++)frame.fill(200,y*width+bit*8,y*width+bit*8+6);
 return frame;
}

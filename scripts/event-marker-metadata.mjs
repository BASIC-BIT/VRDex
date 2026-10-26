/** Fixed numeric FFmpeg metadata protocol. Never accept discarded partial rows. */
export function parseMarkerMetadata(text,kind) {
 if(typeof text!=='string'||!['video','audio'].includes(kind)||!text.length)throw Error('marker_metadata_protocol');
 for(const line of text.split('\n'))if(Buffer.byteLength(line)>4096)throw Error('marker_metadata_line_bound');
 const pattern=kind==='video'?/^frame:(\d+)\s+pts:(-?\d+)\s+pts_time:[^\n]+\nlavfi\.signalstats\.YAVG=[^\n]+\n/gm:/^frame:(\d+)\s+pts:(-?\d+)\s+pts_time:[^\n]+\nlavfi\.astats\.Overall\.Number_of_samples=([\d.]+)\n/gm;
 const matches=[...text.matchAll(pattern)];
 if(!matches.length||matches.map(m=>m[0]).join('')!==text)throw Error('marker_metadata_protocol');
 return matches.map(m=>{
  const row={index:Number(m[1]),pts:Number(m[2]),...(kind==='audio'?{samples:Number(m[3])}:{})};
  if(!Object.values(row).every(Number.isSafeInteger))throw Error('marker_metadata_integer');
  return row;
 });
}

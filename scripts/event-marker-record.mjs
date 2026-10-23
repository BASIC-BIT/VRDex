import { MARKER_SCHEMA } from './event-source-markers.mjs';
const integer = n => { if(!Number.isSafeInteger(n))throw Error('marker_integer');return n; };
// Same identity classifier as the original two-pixel marker decoder.
const colorClass = (r,g,b) => r>150&&r>2*g&&r>2*b?'a':b>150&&b>2*r&&b>2*g?'b':'slate';
export const IDENTITY_CODES=Object.freeze({unknown:0,a:1,b:2,slate:4});
const identitiesByCode=Object.fromEntries(Object.entries(IDENTITY_CODES).map(([name,code])=>[code,name]));
export function validateIdentityEpochs(record) {
  const epochs=record.identityEpochs,range=record.videoRange;
  if(!Array.isArray(epochs)||!epochs.length)throw Error('marker_identity_missing');
  if(epochs.length>32)throw Error('marker_identity_bound');
  if(!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[1]<=range[0])throw Error('marker_identity_extent');
  for(let i=0;i<epochs.length;i++) {
    const row=epochs[i];
    if(!Array.isArray(row)||row.length!==2||!row.every(Number.isSafeInteger)||!(row[1] in identitiesByCode)||row[0]<range[0]||row[0]>range[1]||(i===0&&row[0]!==range[0])||(i>0&&(row[0]<=epochs[i-1][0]||row[1]===epochs[i-1][1])))throw Error('marker_identity_sequence');
  }
  const at=pts=>identitiesByCode[epochs.findLast(row=>row[0]<=pts)?.[1]];
  for(const v of record.visuals??[]) {
    if(!Number.isSafeInteger(v.start)||!Number.isSafeInteger(v.end)||v.start<range[0]||v.end>range[1]||v.end<=v.start||at(v.start)!==v.identity||at(v.end-1)!==v.identity)throw Error('marker_identity_visual');
    if(!Number.isSafeInteger(v.watermark)||v.watermark< -1)throw Error('marker_identity_watermark');
    if(v.watermark>=0) {
      const w=record.watermarks?.[v.watermark],epoch=epochs.findLast(row=>row[0]<=v.start);
      if(!w||w.identity!==v.identity||w.selectionVideoPts!==epoch[0])throw Error('marker_identity_watermark');
    }
  }
  for(const w of record.watermarks??[]) {
    if(!epochs.some(row=>row[0]===w.selectionVideoPts&&identitiesByCode[row[1]]===w.identity))throw Error('marker_identity_watermark');
  }
  return record;
}
export function precedingIdentityAt(record,selection) {
  validateIdentityEpochs(record);
  const index=record.identityEpochs.findIndex(row=>row[0]===selection);
  if(index<0)throw Error('marker_identity_selection');
  return index?identitiesByCode[record.identityEpochs[index-1][1]]:'unknown';
}

/** Every visual end is an observed off-frame PTS, never an inferred duration. */
export function decodeMarkerVisuals(rgb,rows) {
  if(!(rgb instanceof Uint8Array)||!Array.isArray(rows)||!rows.length||rows.length*6!==rgb.byteLength)throw Error('marker_video_payload');
  const visuals=[],identities=[],identityEpochs=[];
  let current,previous;
  for(let i=0;i<rows.length;i++) {
    const r=rows[i];integer(r.pts);
    if(r.index!==i||(previous!==undefined&&r.pts<=previous))throw Error('marker_video_continuity');
    previous=r.pts;
    const identity=colorClass(...rgb.subarray(i*6,i*6+3));
    if(identities.at(-1)?.identity!==identity) {
      if(identityEpochs.length>=32)throw Error('marker_identity_bound');
      identities.push({identity,pts:r.pts});identityEpochs.push([r.pts,IDENTITY_CODES[identity]]);
    }
    const on=rgb[i*6+3]>180&&rgb[i*6+4]>180&&rgb[i*6+5]>180;
    // A source switch while lit closes one observed span and starts the next.
    if(current&&(!on||current.identity!==identity)) {current.end=r.pts;visuals.push(current);current=undefined;}
    if(on&&!current) {
      if(visuals.length>=4096)throw Error('marker_visual_bound');
      current={id:visuals.length,start:r.pts,identity,watermark:-1};
    }
  }
  if(current)throw Error('marker_visual_unmatched_eof');
  return {schema:MARKER_SCHEMA,visuals,identities,identityEpochs,videoRange:[rows[0].pts,rows.at(-1).pts],videoFrames:rows.length};
}

import { createAcquisitionDeadline } from './event-marker-native-binding.mjs';
/** Two exact link-local originals, retained before parsing, within the original
 * two-second/65536-byte limits. This collector supplies observations, never an
 * approval or an invented equality between registry and runtime image IDs. */
export async function captureNativeMetadata({environment=process.env,fetchImpl=fetch,store,prefix,control}) {
 const u=new URL(environment.ECS_CONTAINER_METADATA_URI_V4);if(u.protocol!=='http:'||u.hostname!=='169.254.170.2'||u.port||u.username||u.password||u.search||u.hash||!/^\/v4\/[a-zA-Z0-9-]+$/.test(u.pathname))throw Error('native_metadata_endpoint');
 const deadline=createAcquisitionDeadline(2000),start=performance.now(),signal=AbortSignal.any([deadline.signal,control.signal]);
 let first;try{const settled=await Promise.allSettled(['/task',''].map(async(suffix,i)=>{try{const response=await deadline.run(()=>fetchImpl(u.href+suffix,{redirect:'error',signal}));if(!response.ok||!response.body)throw Error('native_metadata_response');const reader=response.body.getReader(),parts=[];let bytes=0;
  try{for(;;){const part=await deadline.run(()=>reader.read());if(part.done)break;bytes+=part.value.length;if(bytes>65536)throw Error('native_metadata_cap');parts.push(Buffer.from(part.value));}}catch(error){void reader.cancel().catch(()=>{});throw error;}
  const raw=Buffer.concat(parts),elapsedMs=performance.now()-start,ref=await control.run(()=>store.write(`${prefix}-metadata-${i}.json`,raw,65536,'runtimeBinding',control));await control.run(()=>store.json(`${prefix}-metadata-${i}-owner.json`,{url:u.href+suffix,status:response.status,bytes,elapsedMs,bodyEOF:true,ref},196608,'runtimeBinding',control));JSON.parse(raw);return {...ref,elapsedMs};
 }catch(error){first??=error;throw error;}}));if(first)throw first;return settled.map(r=>r.value);}finally{deadline.dispose();}
}

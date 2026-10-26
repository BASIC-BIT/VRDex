import { plan } from './authority.mjs';
import { parseMarkerMetadata } from '../event-marker-metadata.mjs';
import { createHash } from 'node:crypto';
import { feed } from './codec-io.mjs';
export async function normalizeMono(owner,pcm) {
 if(!Buffer.isBuffer(pcm)||pcm.length>2097152||pcm.length%2)throw Error('qualification_normalization_input');
 const child=owner.start('ffmpeg',[...plan.normalization.argumentArray],{stdio:['pipe','ignore','pipe','ignore','pipe','pipe']});
 // Normalizer raw PCM is fd4, while the shared collector reads stdout.
 const parts=[],metadata=[];let total=0,metaBytes=0,stderrBytes=0,failed=false;
 const stop=()=>{failed=true;try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
 child.stdio[4].on('data',b=>{total+=b.length;if(total>5242880)stop();else parts.push(b);});
 child.stdio[5].on('data',b=>{metaBytes+=b.length;if(metaBytes>1048576)stop();else metadata.push(b);});
 child.stderr.on('data',b=>{stderrBytes+=b.length;if(stderrBytes>65536)stop();});
 const timer=setTimeout(stop,15000);
 let code;try{[code]=await Promise.all([child.closed,feed(child.stdin,[pcm])]);}finally{clearTimeout(timer);}
 if(code!==0||failed)throw Error('qualification_normalization_failure');
 const bytes=Buffer.concat(parts),rows=parseMarkerMetadata(Buffer.concat(metadata).toString(),'audio');
 let end;for(let i=0;i<rows.length;i++){const r=rows[i];if(r.index!==i||r.samples<=0||(end!==undefined&&r.pts!==end))throw Error('qualification_normalization_metadata');end=r.pts+r.samples;}
 if(rows.reduce((n,r)=>n+r.samples,0)*4!==bytes.length)throw Error('qualification_normalization_bytes');
 return {pcm:bytes,rows,inputSamples:pcm.length/2,outputSamples:bytes.length/4,inputSha256:createHash('sha256').update(pcm).digest('hex'),outputSha256:createHash('sha256').update(bytes).digest('hex')};
}

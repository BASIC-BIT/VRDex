import { createHash } from 'node:crypto';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const fail=()=>{throw Error('marker_native_progress');};
const integer=(text,{signed=false}={})=>{
 if(!(signed?/^-?(?:0|[1-9]\d*)$/:/^(?:0|[1-9]\d*)$/).test(text))fail();
 const n=BigInt(text);if(n<BigInt(Number.MIN_SAFE_INTEGER)||n>BigInt(Number.MAX_SAFE_INTEGER))fail();return Number(n);
};
function timeValue(text) {
 if(text==='N/A')return null;
 const m=/^(-?)(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{6})$/.exec(text);if(!m)fail();
 const us=((BigInt(m[2])*60n+BigInt(m[3]))*60n+BigInt(m[4]))*1000000n+BigInt(m[5]);return integer((m[1]==='-'?-us:us).toString(),{signed:true});
}
/** Parse the pinned print_report script output from complete original bytes.
 * Counts/refs are observations only; progress=end is never an EOF theorem. */
export function parseNativeProgress(raw,{videoStreams}) {
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>1048576||!Array.isArray(videoStreams)||videoStreams.length>2)fail();
 const qkeys=videoStreams.map(({file,stream})=>{if(!Number.isSafeInteger(file)||file<0||file>255||!Number.isSafeInteger(stream)||stream<0||stream>255)fail();return `stream_${file}_${stream}_q`;});
 if(new Set(qkeys).size!==qkeys.length)fail();
 const required=['bitrate','total_size','out_time_us','out_time_ms','out_time','dup_frames','drop_frames','speed','progress',...(qkeys.length?['frame','fps',...qkeys]:[])],allowed=new Set(required);
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),sha256=createHash('sha256').update(bytes).digest('hex'),blocks=[];let block={},begin=0,ended=false;
 if(bytes.at(-1)!==10)fail();
 for(let end=0;end<bytes.length;end++)if(bytes[end]===10) {
  let line;try{line=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(begin,end));}catch{fail();}
  const match=/^([a-z0-9_]+)=(.*)$/.exec(line);if(ended||!match||!allowed.has(match[1])||Object.hasOwn(block,match[1]))fail();
  const [,key,text]=match;let value=text;
  if(['frame','dup_frames','drop_frames'].includes(key))value=integer(text);
  else if(['total_size','out_time_us','out_time_ms'].includes(key))value=text==='N/A'?null:integer(text,{signed:key!=='total_size'});
  else if(key==='out_time')value=timeValue(text);
  else if(key==='fps'||qkeys.includes(key)){if(!/^-?\d+\.\d+$/.test(text)||!Number.isFinite(Number(text)))fail();value=Number(text);if(key==='fps'&&value<0)fail();}
  else if(key==='bitrate'){if(text!=='N/A'&&!/^ *\d+\.\d+kbits\/s$/.test(text))fail();}
  else if(key==='speed'){if(text!=='N/A'&&(!/^ *\d+(?:\.\d+)?(?:e[+-]?\d+)?x$/.test(text)||!Number.isFinite(Number(text.slice(0,-1)))))fail();}
  else if(key==='progress'&&!['continue','end'].includes(text))fail();
  block[key]={value,refs:[{sha256,beginByte:begin,endByte:end+1}],original:line+'\n'};begin=end+1;
  if(key==='progress') {
   if(Object.keys(block).length!==required.length||required.some(k=>!Object.hasOwn(block,k))||block.out_time_ms.value!==block.out_time_us.value||block.out_time.value!==block.out_time_us.value)fail();
   if(blocks.length&&qkeys.length&&block.frame.value<blocks.at(-1).frame.value)fail();
   ended=text==='end';if(ended&&block.out_time_us.value===null)fail();blocks.push(block);block={};
  }
 }
 if(!ended||Object.keys(block).length)fail();return freeze({sha256,bytes:bytes.length,blocks,final:blocks.at(-1)});
}

/** Native print_final_stats populations are post-demux input packets versus
 * mux-submission payloads, never whole container bytes. Known warning forms
 * remain obligations (layout/queue/nonseekable-header) for the bound plan. */
export function parseNativeStatistics(raw,{stderrCap}) {
 const bad=()=>{throw Error('marker_native_trace');};
 const count=text=>{try{return integer(text);}catch{bad();}};
 const sum=(rows,key)=>count(rows.reduce((n,row)=>n+BigInt(row[key]),0n).toString());
 if(!(raw instanceof Uint8Array)||![65536,1048576].includes(stderrCap)||raw.byteLength<1||raw.byteLength>stderrCap)bad();
 const bytes=Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength),sha256=createHash('sha256').update(bytes).digest('hex'),inputs=[],outputs=[],warnings=[],fpsSummaries=[],fpsContexts=new Set();
 let current,terminal,begin=0,level,context='';
 if(bytes.at(-1)!==10)bad();
 for(let end=0;end<bytes.length;end++)if(bytes[end]===10) {
  let original;try{original=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(begin,end));}catch{bad();}
  if(/[\x00-\x08\x0b-\x1f\x7f]/.test(original))bad();
  const ref={sha256,beginByte:begin,endByte:end+1};begin=end+1;
  const prefix=/^((?:\[[^\[\]\r\n]+ @ 0x[0-9a-fA-F]+\] )*)\[(\w+)\] (.*)$/.exec(original);let text;
  // log.c formats one prefix per call, so physical continuation lines may
  // inherit it. A new bracketed diagnostic start must parse completely.
  if(prefix){[,context,level,text]=prefix;}else{if(!level||/^[ \t]*\[/.test(original))bad();text=original;}
  if(!['info','verbose','warning'].includes(level))bad();
  if(level==='warning') {
   let m,warning;
   if((m=/^Guessed Channel Layout for Input Stream #(\d+)\.(\d+) : (mono|stereo)$/.exec(text)))warning={kind:'guessedLayout',file:count(m[1]),stream:count(m[2]),layout:m[3]};
   else if((m=/^Thread message queue blocking; consider raising the thread_queue_size option \(current value: (\d+)\)$/.exec(text)))warning={kind:'queueBlocking',queueSize:count(m[1])};
   else if((m=/^Failed to update header with correct (duration|filesize)\.$/.exec(text))&&/^\[flv @ /.test(context))warning={kind:'flvHeaderUpdate',field:m[1]};
   else bad();
   warnings.push({...warning,refs:[ref]});continue;
  }
  if(text==='No more output streams to write to, finishing.') {
   if(level!=='verbose'||terminal||inputs.length||outputs.length)bad();terminal={refs:[ref]};continue;
  }
  let m;
  if((m=/^(Input|Output) file #(\d+) \((.*)\):$/.exec(text))) {
   if(level!=='verbose'||!terminal||current||m[1]==='Input'&&outputs.length)bad();
   const files=m[1]==='Input'?inputs:outputs,file=count(m[2]);if(file!==files.length)bad();
   current={direction:m[1],file,url:m[3],streams:[],refs:[ref]};files.push(current);continue;
  }
  if((m=/^  Input stream #(\d+):(\d+) \((video|audio)\): (\d+) packets read \((\d+) bytes\); (?:(\d+) frames decoded(?: \((\d+) samples\))?; )?$/.exec(text))) {
   if(level!=='verbose'||current?.direction!=='Input'||count(m[1])!==current.file||count(m[2])!==current.streams.length)bad();
   const frames=m[6]===undefined?null:count(m[6]),samples=m[7]===undefined?null:count(m[7]);
   if((frames!==null&&m[3]==='audio')!==(samples!==null))bad();
   current.streams.push({file:current.file,stream:count(m[2]),type:m[3],packets:count(m[4]),bytes:count(m[5]),frames,samples,refs:[ref]});continue;
  }
  if((m=/^  Output stream #(\d+):(\d+) \((video|audio)\): (\d+) frames encoded(?: \((\d+) samples\))?; (\d+) packets muxed \((\d+) bytes\); $/.exec(text))) {
   if(level!=='verbose'||current?.direction!=='Output'||count(m[1])!==current.file||count(m[2])!==current.streams.length)bad();
   const samples=m[5]===undefined?null:count(m[5]);if((m[3]==='audio')!==(samples!==null))bad();
   current.streams.push({file:current.file,stream:count(m[2]),type:m[3],frames:count(m[4]),samples,packets:count(m[6]),bytes:count(m[7]),refs:[ref]});continue;
  }
  if((m=/^  Total: (\d+) packets \((\d+) bytes\) (demuxed|muxed)$/.exec(text))) {
   if(level!=='verbose'||!current||!current.streams.length||(current.direction==='Input'?'demuxed':'muxed')!==m[3]||sum(current.streams,'packets')!==count(m[1])||sum(current.streams,'bytes')!==count(m[2]))bad();
   current.total={packets:count(m[1]),bytes:count(m[2]),refs:[ref]};current=undefined;continue;
  }
  if((m=/^(\d+) frames in, (\d+) frames out; (\d+) frames dropped, (\d+) frames duplicated\.$/.exec(text))) {
   if(level!=='verbose'||!/^\[Parsed_fps_\d+ @ /.test(context)||fpsContexts.has(context))bad();
   const [input,output,dropped,duplicated]=m.slice(1).map(count);
   if(BigInt(input)+BigInt(duplicated)!==BigInt(output)+BigInt(dropped))bad();
   fpsContexts.add(context);fpsSummaries.push({input,output,dropped,duplicated,context,refs:[ref]});continue;
  }
  if(/\bframes?\s+(?:in|out|dropped|duplicated)\b/.test(text)||/^\[Parsed_fps_\d+ @ /.test(context)&&/^\s*[-+]?(?:\d|NaN|Infinity)/.test(text))bad();
  if(/^(?:Input file|Output file|  Input stream|  Output stream|  Total:)/.test(text))bad();
  // Other INFO/VERBOSE data remain in the complete original channel. These
  // extracted counters do not establish negotiation, timestamps or E/F/R.
 }
 if(!terminal||current||!inputs.length||!outputs.length)bad();return freeze({sha256,bytes:bytes.length,terminal,inputs,outputs,warnings,fpsSummaries});
}

import { createHash } from 'node:crypto';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const invalid=()=>{throw Error('marker_native_argv');};
/** Ruling68 A: diagnostic-only edits. This proves reversibility, not that an
 * arbitrary argv matches one of the separately checked E/F/R source plans. */
export function diagnosticArguments(original,{stdio}) {
 if(!Array.isArray(original)||original.some(x=>typeof x!=='string')||!Array.isArray(stdio))invalid();
 const args=[...original],log=[],progress=[];
 args.forEach((arg,index)=>{
  if(arg==='-loglevel'||arg==='-v')log.push(index);
  if(arg==='-progress')progress.push(index);
  // cmdutils.c:524 raises AV_LOG_DEBUG independently of -loglevel;
  // :527-537 and :176/:773 also accept stream/legacy and boolean forms.
  if(/^-(?:(?:no)?debug_ts|[vas]?debug|fdebug)(?:[:=]|$)/.test(arg))invalid();
  if(arg==='-report'||arg.startsWith('-report=')||/^-(?:loglevel|v)[=:]/.test(arg)||arg==='-stats')invalid();
 });
 if(log.length!==1||!['error','info'].includes(args[log[0]+1])||progress.length>1||args.filter(x=>x==='-nostats').length>1)invalid();
 const edits=[],pipes=[...stdio];let progressFd;
 const replace=(index,value)=>{edits.push({kind:'replace',index,original:args[index],value});args[index]=value;};
 const prepend=values=>{edits.push({kind:'insert',index:0,values});args.unshift(...values);};
 if(progress.length) {
  const match=/^pipe:(\d+)$/.exec(original[progress[0]+1]);if(!match)invalid();progressFd=Number(match[1]);
  if(!Number.isSafeInteger(progressFd)||progressFd<3||pipes[progressFd]!=='pipe')invalid();
  if(original.some((arg,index)=>index!==progress[0]+1&&[...arg.matchAll(/pipe\\*:(\d+)/g)].some(m=>Number(m[1])===progressFd)))invalid();
 }
 replace(log[0]+1,'repeat+level+verbose');
 if(!args.includes('-nostats'))prepend(['-nostats']);
 if(progressFd===undefined) {
  if(pipes.length>7||original.some(arg=>[...arg.matchAll(/pipe\\*:(\d+)/g)].some(m=>Number(m[1])===7)))invalid();
  progressFd=7;while(pipes.length<7)pipes.push('ignore');pipes.push('pipe');prepend(['-progress','pipe:7']);
 }
 const binding={original:[...original],originalSHA256:sha(original),args,diagnosticSHA256:sha(args),edits,stdio:pipes,progressFd};
 restoreDiagnosticArguments(binding);return freeze(binding);
}
export function restoreDiagnosticArguments(binding) {
 if(!binding||!Array.isArray(binding.args)||!Array.isArray(binding.original)||!Array.isArray(binding.edits)||sha(binding.args)!==binding.diagnosticSHA256||sha(binding.original)!==binding.originalSHA256)invalid();
 const restored=[...binding.args];
 for(const edit of [...binding.edits].reverse()) {
  if(!Number.isSafeInteger(edit.index)||edit.index<0||edit.index>=restored.length)invalid();
  if(edit.kind==='replace'){if(restored[edit.index]!==edit.value)invalid();restored[edit.index]=edit.original;}
  else if(edit.kind==='insert'){if(!Array.isArray(edit.values)||JSON.stringify(restored.slice(edit.index,edit.index+edit.values.length))!==JSON.stringify(edit.values))invalid();restored.splice(edit.index,edit.values.length);}
  else invalid();
 }
 if(JSON.stringify(restored)!==JSON.stringify(binding.original)||sha(restored)!==binding.originalSHA256)invalid();return restored;
}

/** Observe submitted bytes and actual Writable callbacks/finish. No consumer
 * EOF or native drain claim is inferred from these host-side events. The raw
 * trace sink has a trusted producer/retention policy supplied by its owner. */
export async function captureNativeFeed(stream,chunks,{byteCap,trace}) {
 if(!Number.isSafeInteger(byteCap)||byteCap<0)throw Error('marker_native_feed_bound');
 const attemptedHash=createHash('sha256'),secondaryErrors=[];let writtenHash=createHash('sha256');
 let attemptedBytes=0,writtenBytes=0,writeCallbacks=0,index=0,writeFinish=false,firstError,closed=stream.destroyed===true;
 let iterator,asyncIterator=false,sourceDone=false,interruptNext,cancellationOutcome,sourceCancellation={requested:false,complete:null};
 const remember=error=>{firstError??=error;interruptNext?.(firstError);},onClose=()=>{closed=true;if(!writeFinish)remember(Error('qualification_input_pipe'));};
 stream.on('error',remember);stream.on('close',onClose);
 const emit=event=>{const observed=trace.write(Buffer.from(JSON.stringify(event)+'\n'));if(observed.producerExceeded||observed.retentionStopped)throw Error('byte_cap');};
 function nextChunk() {
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error,value)=>{if(settled)return;settled=true;interruptNext=undefined;if(error)reject(error);else resolve(value);};
   interruptNext=error=>finish(error);
   if(firstError||closed)return finish(firstError??Error('qualification_input_pipe'));
   // Only one cancellable waiter is retained. A late next() result is consumed
   // by these handlers but cannot submit another chunk after pipe termination.
   Promise.resolve().then(()=>{
    const next=iterator.next();if(asyncIterator)return next;
    // Async-from-sync awaits the value (including a final done value); a true
    // async iterator owns its value semantics. Keep this wait interruptible.
    if(next===null||!['object','function'].includes(typeof next))throw TypeError('marker_native_feed_iterator');
    const done=Boolean(next.done);return Promise.resolve(next.value).then(value=>({done,value}));
   }).then(value=>finish(null,value),error=>finish(error));
  });
 }
 function operation(start,{finish=false}={}) {
  return new Promise((resolve,reject)=>{
   let settled=false;
   const cleanup=()=>{stream.removeListener('error',onError);stream.removeListener('close',onClosed);if(finish)stream.removeListener('finish',onFinish);};
   const done=error=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
   const onError=error=>done(error),onClosed=()=>done(firstError??Error('qualification_input_pipe')),onFinish=()=>{writeFinish=true;done();};
   stream.once('error',onError);stream.once('close',onClosed);if(finish)stream.once('finish',onFinish);
   if(firstError||closed||stream.writableFinished)return done(firstError??Error('qualification_input_pipe'));
   try{start(done,()=>settled);}catch(error){done(error);}
  });
 }
 try {
  const asyncMethod=chunks[Symbol.asyncIterator];asyncIterator=asyncMethod!==null&&asyncMethod!==undefined;
  iterator=asyncIterator?asyncMethod.call(chunks):chunks[Symbol.iterator]?.();
  if(!iterator||typeof iterator.next!=='function')throw Error('marker_native_feed_type');
  for(;;) {
   const next=await nextChunk();if(next.done){sourceDone=true;break;}const chunk=next.value;
   if(!(chunk instanceof Uint8Array))throw Error('marker_native_feed_type');
   const bytes=Buffer.from(chunk),chunkBytes=bytes.length,chunkSHA256=createHash('sha256').update(bytes).digest('hex');
   attemptedBytes+=chunkBytes;if(!Number.isSafeInteger(attemptedBytes))throw Error('byte_cap');attemptedHash.update(bytes);
   if(attemptedBytes>byteCap)throw Error('byte_cap');
   emit({event:'write',index,bytes:chunkBytes,sha256:chunkSHA256});
   const prospectiveWrittenHash=writtenHash.copy().update(bytes);
   await operation((done,settled)=>stream.write(bytes,error=>{
    if(settled())return;writeCallbacks++;
    if(!error){writtenBytes+=chunkBytes;writtenHash=prospectiveWrittenHash;}
    try{emit({event:'callback',index,ok:!error});}catch(captureError){error??=captureError;}
    done(error);
   }));index++;
  }
  emit({event:'end',writes:index});await operation(()=>stream.end(),{finish:true});emit({event:'finish'});
 }catch(error){
  remember(error);stream.destroy();
  if(iterator&&!sourceDone&&typeof iterator.return==='function') {
   sourceCancellation={requested:true,complete:false};
   try{
    // An async generator may queue return() behind an uncooperative next().
    // Request cancellation now, expose its eventual outcome separately, and
    // do not claim observed source cleanup or block failure-trace finalization.
    cancellationOutcome=Promise.resolve(iterator.return()).then(value=>({complete:value?.done===true,error:null}),error=>({complete:false,error}));
   }catch(error){secondaryErrors.push(error);cancellationOutcome=Promise.resolve({complete:false,error});}
  }
 }
 finally{
  // Writable emits its error after invoking a failed write callback. Keep the
  // listener through close so that original deferred error remains observed.
  const cleanup=()=>{stream.removeListener('error',remember);stream.removeListener('close',onClose);};
  if(closed)cleanup();else stream.once('close',cleanup);
 }
 let retained,traceState;
 try {
  retained=trace.finish();if(!retained||typeof retained.complete!=='boolean')throw Error('marker_raw_incomplete');
  traceState=retained.complete?'complete':'partial';
  if(!retained.complete){const error=Error('byte_cap');if(firstError)secondaryErrors.push(error);else remember(error);}
 }catch(error){
  if(firstError)secondaryErrors.push(error);else remember(error);
  retained=Object.freeze({complete:false,available:false});traceState='unavailable';
 }
 const writtenSHA256=writtenHash.digest('hex');
 const result={attemptedBytes,attemptedSHA256:attemptedHash.digest('hex'),writtenBytes,writtenSHA256,writeCallbacks,writeFinish,actualFedByteCount:writeFinish?writtenBytes:null,actualFedSHA256:writeFinish?writtenSHA256:null,complete:writeFinish&&!firstError&&retained.complete,error:firstError??null,secondaryErrors:Object.freeze(secondaryErrors),sourceCancellation:Object.freeze(sourceCancellation),traceState,trace:retained};
 if(cancellationOutcome)Object.defineProperty(result,'cancellationOutcome',{value:cancellationOutcome});return result;
}

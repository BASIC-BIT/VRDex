import { createAcquisitionDeadline } from './event-marker-native-binding.mjs';

/** One cancellation boundary for a CLI invocation. Work aborts immediately;
 * physical owner cleanup uses only the reserve inside the original deadline.
 * Process signals and an external abort share the same first primary cause. */
export function createOwnedCancellation({control,signal,cleanupMs,name}) {
 const work=createAcquisitionDeadline(Math.max(0,control.deadline-performance.now()-cleanupMs)),abort=new AbortController(),owners=new Set(),closing=new Map(),listeners=[];
 const remaining=()=>Math.max(0,control.deadline-performance.now());
 function close(owner){
  if(!closing.has(owner)){
   const pending=Promise.resolve().then(()=>owner.close({timeoutMs:Math.min(cleanupMs,remaining()),termMs:500}));
   // Always start close, including a late acquisition. Never reopen its census.
   const bounded=control.run(()=>pending);bounded.catch(()=>{});closing.set(owner,bounded);
  }
  return closing.get(owner);
 }
 function cancel(reason){if(!abort.signal.aborted){abort.abort(reason instanceof Error?reason:Error(name+'_cancelled'));for(const owner of owners)void close(owner).catch(()=>{});}}
 for(const source of [control.signal,work.signal,signal].filter(Boolean)){
  const listener=()=>cancel(source.reason);source.addEventListener('abort',listener,{once:true});listeners.push(()=>source.removeEventListener('abort',listener));if(source.aborted)listener();
 }
 for(const event of ['SIGINT','SIGTERM']){const listener=()=>cancel(Error(name+'_cancelled:'+event));process.on(event,listener);listeners.push(()=>process.removeListener(event,listener));}
 const check=()=>{control.check();work.check();abort.signal.throwIfAborted();};
 async function run(operation){
  check();let listener;const cancelled=new Promise((_,reject)=>{listener=()=>reject(abort.signal.reason);abort.signal.addEventListener('abort',listener,{once:true});});
  try{const result=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),cancelled]);check();return result;}finally{abort.signal.removeEventListener('abort',listener);}
 }
 async function own(factory){
  check();const pending=Promise.resolve().then(()=>{check();return factory();}).then(owner=>{owners.add(owner);if(abort.signal.aborted)void close(owner).catch(()=>{});return owner;});
  pending.catch(()=>{});
  return run(()=>pending);
 }
 async function closeAll(){const settled=await Promise.allSettled([...owners].map(close));const errors=settled.flatMap(s=>s.status==='rejected'?[s.reason]:s.value?.closed&&s.value.emptyCensuses===2?[]:[Error(name+'_physical_cleanup')]);if(errors.length)throw Object.assign(errors[0],{cleanupFailures:errors});return settled.map(s=>s.value);}
 return {deadline:work.deadline,signal:abort.signal,check,run,own,close,closeAll,remaining,get reason(){return abort.signal.aborted?abort.signal.reason:null;},dispose(){for(const remove of listeners)remove();work.dispose();control.dispose();}};
}

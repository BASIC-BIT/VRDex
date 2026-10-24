import { executeLiteral } from './literal.mjs';
/** Literal invocations have no children. Every frozen index is observed exactly
 * once, including explicit incomplete rows after a deadline. No retries. */
export function runLiteralInvocation(invocation,{clock=()=>performance.now(),workMs=90000}={}) {
 if(invocation.kind!=='literal'||invocation.rows.length>2048)throw Error('qualification_literal_invocation');
 const start=clock(),results=[];let timedOut=false;
 for(const [index,row] of invocation.rows.entries()) {
  timedOut ||= clock()-start>=workMs;
  if(timedOut){results.push({index,status:'incomplete',reason:'timeout'});continue;}
  try {
   const facts=executeLiteral(row);
   if(Buffer.byteLength(JSON.stringify(facts))>512)throw Error('qualification_case_fact_bound');
   results.push({index,status:'pass',facts});
  } catch(error) {
   results.push({index,status:'fail',reason:error.code==='ERR_ASSERTION'?'literal_assertion':/^literal_[a-z_]+$/.test(error.message)?error.message:'literal_contract_error',
    actual:Number.isFinite(error.actual)?error.actual:null,expected:Number.isFinite(error.expected)?error.expected:null});
  }
 }
 return {id:invocation.id,results,elapsedMs:clock()-start,passed:results.length===invocation.rows.length&&results.every(r=>r.status==='pass')};
}

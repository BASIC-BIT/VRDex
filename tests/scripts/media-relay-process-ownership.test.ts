import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLocalProof } from "../../packages/media-relay/src/verification/local";
import { parseProofArgs } from "../../scripts/media-relay-proof";
import { test } from "node:test";
import { createProcessOwnership, captureOwnedProcessGroup } from "../../packages/media-relay/src/verification/process-ownership";

async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child,"close"); child.kill("SIGKILL"); await closed;
}
test("explicit proof roots exclude a concurrent unrelated service and retain owned descendants until reaped", {timeout:5000}, async () => {
  const directory = await mkdtemp(join(tmpdir(),"relay-ownership-"));
  const other = spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
  const ownership = await createProcessOwnership(directory);
  const node = await ownership.executable("node");
  const owned = spawn(node,["-e",`const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.on('SIGTERM',()=>{child.once('close',()=>process.exit(0));child.kill('SIGKILL');});console.log(child.pid);`],{stdio:["ignore","pipe","ignore"]});
  try {
    const [output] = await once(owned.stdout!,"data");
    const childPid = Number(String(output).trim());
    const live = await ownership.scan();
    assert.equal(live.length,2,JSON.stringify({live,root:owned.pid,childPid})); // Unclean owned processes must fail zero-children evidence.
    assert.ok(live.some(p=>p.pid===owned.pid));
    assert.ok(!live.some(p=>p.pid===other.pid));
    const closed = once(owned,"close");owned.kill("SIGTERM");await closed;
    assert.deepEqual(await ownership.scan(),[]);
    assert.equal(other.exitCode,null);process.kill(other.pid!,0);
    // A reused PID with a different start identity cannot acquire ownership.
    await appendFile(join(directory,"media-processes"),`${other.pid} 0\n`);
    assert.deepEqual(await ownership.scan(),[]);
  } finally {
    if (owned.exitCode === null && owned.signalCode === null) {
      const closed = once(owned,"close");owned.kill("SIGTERM");await closed;
    }
    await stop(other);await rm(directory,{recursive:true,force:true});
  }
});
test("proof parent settles its detached runtime group after leader exit without touching unrelated services", {timeout:5000}, async () => {
  const other = spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
  const helper = `process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);`;
  const leader = spawn(process.execPath,["-e",`const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{console.log(child.pid);setTimeout(()=>process.exit(0),100);});`],{detached:true,stdio:["ignore","pipe","ignore"]});
  let text="";leader.stdout!.on("data",chunk=>text+=chunk);
  try {
    const closed = once(leader,"close");
    const group = await captureOwnedProcessGroup(leader);
    await closed;
    const helper=Number(text.trim());assert.ok(helper>0);
    await group.settle(Date.now()+3000);
    const stat=await readFile(`/proc/${helper}/stat`,"utf8").catch(()=>null);
    assert.ok(stat===null || stat.slice(stat.lastIndexOf(')')+2).startsWith('Z '));
    assert.equal(other.exitCode,null);process.kill(other.pid!,0);
  } finally { try{process.kill(-leader.pid!,"SIGKILL");}catch{} await stop(other); }
});

test("actual local proof does not claim an unrelated child as leaked media", {timeout:15000}, async () => {
  const directory = await mkdtemp(join(tmpdir(),"relay-unrelated-service-"));
  const service = spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
  try {
    const evidence = await runLocalProof(parseProofArgs(["--deadline","1","--output",directory]));
    assert.equal(evidence.cleanup.childrenAlive,0,JSON.stringify(evidence.cleanup));
    assert.equal(evidence.cleanup.scratchBytes,0);
    assert.ok(!evidence.failures.includes("cleanup incomplete"));
    assert.equal(service.exitCode,null);process.kill(service.pid!,0);
    await assert.rejects(captureOwnedProcessGroup(service),/ownership/);
  } finally { await stop(service);await rm(directory,{recursive:true,force:true}); }
});

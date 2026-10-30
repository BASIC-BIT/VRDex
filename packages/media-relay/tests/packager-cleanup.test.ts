import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
for (const trigger of ["failure", "abort"]) test(`packager ${trigger} cleanup EIO stays handled under default Node rejection policy`, async () => {
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    fs.mkdir = async () => {};
    fs.mkdtemp = async () => '/tmp/attempt-1-cleanup';
    fs.rm = async () => {throw Error('cleanup EIO');};
    syncBuiltinESMExports();
    const {createPackager} = await import('./src/worker/packager.ts');
    const abort = new AbortController();
    let failures = 0;
    let release;
    const pending = new Promise(resolve => {release = resolve;});
    const start = createPackager({createRelay:async () => {
      if (${JSON.stringify(trigger)} === 'abort') await pending;
      throw Error('acquisition failed');
    }});
    const starting = start({source:{streamKey:'vrcdn/Alpha/1',streamId:'Alpha',inputFormat:'vrcdn_fmp4',packagingVersion:1},epoch:1,directory:'/tmp/unused-cleanup',signal:abort.signal,onSnapshot(){},onFailure(){failures++;}});
    if (${JSON.stringify(trigger)} === 'abort') {
      await new Promise(resolve => setImmediate(resolve));
      abort.abort();
      release();
    }
    const handle = await starting;
    await assert.rejects(handle.stop(), /cleanup EIO/);
    await new Promise(resolve => setTimeout(resolve,30));
    assert.equal(failures, ${trigger === "failure" ? 1 : 0});
    console.log('survived with stop rejection retained');
  `;
  const result = await run(process.execPath,["--import","tsx","--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:5000});
  assert.match(result.stdout,/survived with stop rejection retained/);
});

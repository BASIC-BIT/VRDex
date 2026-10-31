import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const run = promisify(execFile);
test("low scratch filesystem free blocks trigger pressure without FFmpeg diagnostics", async () => {
  const marker = `/tmp/relay-free-blocks-${randomUUID()}`;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const {createPackager} = await import('./src/worker/packager.ts');
    const root = await fs.mkdtemp('/tmp/relay-free-blocks-root-');
    const originalStatfs = fs.statfs;
    fs.statfs = async () => ({bavail:0,bsize:4096});
    syncBuiltinESMExports();
    let releaseRelay, observed;
    const gate = new Promise(resolve => {releaseRelay = resolve;});
    const failure = new Promise(resolve => {observed = resolve;});
    const start = createPackager({createRelay:async () => {await gate; return {stop(){}};}});
    const starting = start({
      source:{streamKey:'vrcdn/Alpha/1',streamId:'Alpha',inputFormat:'vrcdn_fmp4',packagingVersion:1},
      epoch:1,directory:root,scratchRoot:root,signal:new AbortController().signal,
      onSnapshot(){},onFailure:observed
    });
    try {
      const result = await Promise.race([
        failure,
        new Promise((_,reject) => setTimeout(() => reject(Error('pressure not detected')), 500))
      ]);
      assert.equal(result.kind, 'pressure');
      await fs.writeFile('${marker}', 'free blocks pressure verified');
    } finally {
      releaseRelay();
      const handle = await starting;
      await handle.stop();
      fs.statfs = originalStatfs;
      syncBuiltinESMExports();
      await fs.rm(root,{recursive:true,force:true});
    }
  `;
  try {
    await run(process.execPath,["--import","tsx","--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:5000});
    assert.match(await readFile(marker, "utf8"), /free blocks pressure verified/);
  } finally {
    await rm(marker, { force: true });
  }
});
test("scratch monitor churn never overlaps scans of the same root", async () => {
  const marker = `/tmp/relay-monitor-${randomUUID()}`;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import {join} from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    const {createPackager} = await import('./src/worker/packager.ts');
    const root = await fs.mkdtemp('/tmp/relay-monitor-root-');
    const originalReaddir = fs.readdir;
    let active = 0, peak = 0, relayCalls = 0, releaseScan, releaseRelay;
    let scanStarted, secondRelayStarted;
    const firstScan = new Promise(resolve => {scanStarted = resolve;});
    const secondRelay = new Promise(resolve => {secondRelayStarted = resolve;});
    const within = (promise, label) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(label)), 3000);
      promise.then(value => {clearTimeout(timer); resolve(value);}, error => {clearTimeout(timer); reject(error);});
    });
    const scan = new Promise(resolve => {releaseScan = resolve;});
    const relay = new Promise(resolve => {releaseRelay = resolve;});
    fs.readdir = async (path, ...args) => {
      if (String(path) !== root) return originalReaddir(path, ...args);
      active++;
      peak = Math.max(peak, active);
      scanStarted();
      await scan;
      active--;
      return [];
    };
    syncBuiltinESMExports();
    const start = createPackager({createRelay:async () => {relayCalls++; if (relayCalls === 2) secondRelayStarted(); await relay; return {stop(){}};}});
    const first = new AbortController(), second = new AbortController();
    const options = {source:{streamKey:'vrcdn/Alpha/1',streamId:'Alpha',inputFormat:'vrcdn_fmp4',packagingVersion:1},epoch:1,scratchRoot:root,onSnapshot(){},onFailure(){}};
    const one = start({...options,directory:join(root,'one'),signal:first.signal});
    try {
      await within(firstScan, 'first root scan did not start');
      assert.equal(active, 1);
      first.abort();
      const two = start({...options,directory:join(root,'two'),signal:second.signal});
      await within(secondRelay, 'second attempt did not reach relay setup');
      assert.equal(relayCalls, 2);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(peak, 1);
      second.abort();
      releaseScan();
      releaseRelay();
      await one;
      await two;
      await fs.writeFile('${marker}', 'single scan verified');
    } finally {
      first.abort(); second.abort(); releaseScan(); releaseRelay();
      fs.readdir = originalReaddir;
      syncBuiltinESMExports();
      await fs.rm(root,{recursive:true,force:true});
    }
  `;
  try {
    await run(process.execPath,["--import","tsx","--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:5000});
    assert.match(await readFile(marker, "utf8"), /single scan verified/);
  } finally {
    await rm(marker, { force: true });
  }
});
test("quota exhaustion before attempt creation is reported as scratch pressure", async () => {
  const marker = `/tmp/relay-quota-${randomUUID()}`;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const {createPackager} = await import('./src/worker/packager.ts');
    fs.mkdir = async () => {throw Object.assign(Error('quota full'), {code:'EDQUOT'});};
    syncBuiltinESMExports();
    await assert.rejects(
      createPackager()({
        source:{streamKey:'vrcdn/Alpha/1',streamId:'Alpha',inputFormat:'vrcdn_fmp4',packagingVersion:1},
        epoch:1,directory:'/tmp/unused-cleanup',signal:new AbortController().signal,
        onSnapshot(){},onFailure(){}
      }),
      (error) => error?.failure?.kind === 'pressure'
    );
    await fs.writeFile('${marker}', 'quota pressure verified');
  `;
  try {
    await run(process.execPath,["--import","tsx","--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:5000});
    assert.match(await readFile(marker, "utf8"), /quota pressure verified/);
  } finally {
    await rm(marker, { force: true });
  }
});
for (const trigger of ["failure", "abort"]) test(`packager ${trigger} cleanup EIO stays handled under default Node rejection policy`, async () => {
  const marker = `/tmp/relay-cleanup-${randomUUID()}`;
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const {createPackager} = await import('./src/worker/packager.ts');
    fs.mkdir = async () => {};
    fs.mkdtemp = async () => '/tmp/attempt-1-cleanup';
    fs.readdir = async () => [];
    fs.statfs = async () => ({bavail:1000000,bsize:4096});
    fs.rm = async () => {throw Error('cleanup EIO');};
    syncBuiltinESMExports();
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
    await fs.writeFile('${marker}', 'survived with stop rejection retained');
  `;
  try {
    await run(process.execPath,["--import","tsx","--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:5000});
    assert.match(await readFile(marker, "utf8"),/survived with stop rejection retained/);
  } finally {
    await rm(marker, { force: true });
  }
});

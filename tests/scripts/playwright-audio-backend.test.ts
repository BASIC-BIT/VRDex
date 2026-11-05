import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function fixture(existing = false, unhealthy = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "audio-backend-test-"));
  const events = path.join(root, "events");
  const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),args=process.argv.slice(2),dir=process.env.PULSE_RUNTIME_PATH;
fs.appendFileSync(process.env.AUDIO_TEST_EVENTS,JSON.stringify({name,args})+'\\n');
if(name==='pulseaudio') {
 if(args.includes('--kill')) {fs.rmSync(path.join(dir,'pid'),{force:true});process.exit(0);}
 const config=fs.readFileSync(args.find(a=>a.startsWith('--file=')).slice(7),'utf8');
 if(config.includes('tcp')||config.includes('auth-anonymous')||!config.includes('auth-cookie='))process.exit(3);
 if((fs.statSync(path.join(dir,'cookie')).mode&511)!==384)process.exit(4);
 fs.writeFileSync(path.join(dir,'pid'),'123');process.exit(0);
}
const live=process.env.AUDIO_TEST_EXISTING==='true'||(dir&&fs.existsSync(path.join(dir,'pid')));
if(!live)process.exit(1);
if(args[0]==='info')console.log('Server Name: test server');
else if(process.env.AUDIO_TEST_UNHEALTHY!=='true')console.log('0 test_sink module-null-sink.c s16le 2ch 44100Hz SUSPENDED');
`;
  for (const name of ["pactl", "pulseaudio"]) { writeFileSync(path.join(root, name), stub); chmodSync(path.join(root, name), 0o700); }
  const env = { ...process.env, RUNNER_TEMP: root, GITHUB_ENV: path.join(root, "github-env"), PATH: `${root}:${process.env.PATH}`, AUDIO_TEST_EVENTS: events, AUDIO_TEST_EXISTING: String(existing), AUDIO_TEST_UNHEALTHY: String(unhealthy), PULSE_RUNTIME_PATH: "", PULSE_SERVER: "", PULSE_COOKIE: "" };
  delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
  return { root, env, run: (mode: string) => spawnSync(process.execPath, ["scripts/playwright-audio-backend.mjs", mode], { env, encoding: "utf8" }), events: () => readFileSync(events, "utf8").trim().split("\n").map(line => JSON.parse(line)), close: () => rmSync(root, { recursive: true, force: true }) };
}
test("reuses an existing usable backend without claiming or stopping it", () => {
  const f = fixture(true);
  try {
    const result = f.run("prepare"); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.run("cleanup").status, 0);
    assert.equal(f.events().filter(event => event.name === "pulseaudio").length, 0);
    assert.equal(existsSync(f.env.GITHUB_ENV), false);
  } finally { f.close(); }
});
test("creates a private authenticated backend only after absence and cleans only its owned runtime", () => {
  const f = fixture();
  try {
    const prepare = f.run("prepare"); assert.equal(prepare.status, 0, prepare.stdout + prepare.stderr);
    const exported = readFileSync(f.env.GITHUB_ENV, "utf8");
    assert.match(exported, /PULSE_SERVER=unix:/);
    assert.match(exported, /PULSE_COOKIE=/);
    const marker = path.join(f.root, "vrdex-playwright-audio.json");
    const { directory } = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(f.events().filter(event => event.name === "pactl" && event.args[0] === "info").length, 2);
    assert.equal(f.run("cleanup").status, 0);
    assert.equal(existsSync(directory), false);
    assert.equal(existsSync(marker), false);
    assert.equal(f.run("cleanup").status, 0);
    assert.equal(f.events().filter(event => event.name === "pulseaudio" && event.args.includes("--kill")).length, 1);
  } finally { f.close(); }
});
test("failed sink validation exports no backend and cleans the attempted owned daemon", () => {
  const f = fixture(false, true);
  try {
    assert.notEqual(f.run("prepare").status, 0);
    assert.equal(existsSync(f.env.GITHUB_ENV), false);
    assert.equal(existsSync(path.join(f.root, "vrdex-playwright-audio.json")), false);
    assert.equal(f.events().filter(event => event.name === "pulseaudio" && event.args.includes("--kill")).length, 1);
  } finally { f.close(); }
});

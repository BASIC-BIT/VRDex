import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
// Exact accepted operands: these test expectations are independent of the DATA exports.
const expected = {
  "workers/restream/broadcast-profiles.mjs": {
    "VIDEO_PROFILES": {
      "480p30": {
        "width": 854,
        "height": 480,
        "frameRate": 30,
        "videoBitrateKbps": 1000
      },
      "480p60": {
        "width": 854,
        "height": 480,
        "frameRate": 60,
        "videoBitrateKbps": 1500
      },
      "720p30": {
        "width": 1280,
        "height": 720,
        "frameRate": 30,
        "videoBitrateKbps": 1800
      },
      "720p60": {
        "width": 1280,
        "height": 720,
        "frameRate": 60,
        "videoBitrateKbps": 2500
      },
      "1080p30": {
        "width": 1920,
        "height": 1080,
        "frameRate": 30,
        "videoBitrateKbps": 3000
      },
      "1080p60": {
        "width": 1920,
        "height": 1080,
        "frameRate": 60,
        "videoBitrateKbps": 3500
      }
    },
    "NEW_PROGRAM_MEDIA_SETTINGS": {
      "videoPreset": "720p30",
      "audioBitrateKbps": 320
    },
    "LEGACY_PROGRAM_MEDIA_SETTINGS": {
      "videoPreset": "720p30",
      "audioBitrateKbps": 160
    },
    "DEFAULT_INPUT_QUALITY": {
      "width": 1280,
      "height": 720,
      "frameRate": 30
    },
    "BROADCAST_ENCODING": {
      "videoCodec": "libx264",
      "videoThreads": "2",
      "normalPreset": "veryfast",
      "highRatePreset": "superfast",
      "highRateVideoPreset": "1080p60",
      "pixelFormat": "yuv420p",
      "sceneThreshold": "0",
      "bFrames": "0",
      "vbvMultiplier": 2,
      "x264Params": "nal-hrd=cbr:force-cfr=1",
      "audioCodec": "aac",
      "audioSampleRateText": "48000",
      "audioChannelsText": "2",
      "programTune": "zerolatency",
      "programMuxFlags": "+resend_headers",
      "programMuxDelay": "0",
      "programMux": "mpegts",
      "outputMux": "flv",
      "twitchAudioBitrateText": "160k"
    },
    "PROGRAM_HOLD_FRAME": {
      "chromaFill": 128,
      "backgroundLuma": 32,
      "rectangleLuma": 80,
      "rectangleStartDivisor": 3,
      "rectangleEndMultiplier": 2,
      "rectangleEndDivisor": 3
    }
  },
  "scripts/event-marker-program-contract.mjs": {
    "PROGRAM_SOURCE_CONTRACT": {
      "design": "aa6d1308c3ed17a2440004d06ef85a5d47aa47d09034b11fe8ddc01087f13c93",
      "guards": "a9cdeede2f5be1c9daf79cc9842b60e079e1bc2dff8501b3cc9cf75f4f9073f7",
      "pins": "8cd6382c44b4c70bde56a20387d8268b8133023c79bd8c5afd90027dbd00e75a"
    }
  },
  "scripts/marker-qualification/construction-data.mjs": {
    "MASS_FRAME_CONSTRUCTION": {
      "width": 854,
      "height": 480,
      "samplesPerFrame": 1600,
      "flashFrames": 3,
      "defaultSource": "a",
      "idleIdentity": "slate",
      "defaultSlot": 0
    },
    "TONE_DEFAULTS": {
      "source": "a",
      "phase": 0,
      "foreignPhase": 0,
      "placement": 0,
      "durationMs": 0,
      "jump": 0,
      "ratio": 0.25,
      "loudSamples": 4800
    },
    "TONE_CONSTRUCTION": {
      "sampleRateHz": 48000,
      "samplesPerMillisecond": 48,
      "amplitude": 0.65,
      "hiddenSamples": 5280,
      "hiddenForeignSamples": 480,
      "unknownFrequencyHz": 1000,
      "phaseJumpAt": 2400,
      "foreignWindowSamples": 4800,
      "foreignCenterSample": 2400,
      "mixtureSamples": 1440,
      "equalMixtureRatio": 1
    },
    "LITERAL_DEFAULTS": {
      "onset": 960,
      "tail": 1440,
      "rowSamples": 1024,
      "noise": "none"
    },
    "LITERAL_NOISE": {
      "amplitude": 0.12
    },
    "NATIVE_NOISE": {
      "seeds": [
        42,
        43
      ],
      "color": "white",
      "amplitude": 0.12,
      "programRateHz": 48000,
      "channelsText": "1",
      "sampleFormat": "s16le",
      "durationPaddingRateUnits": 1
    },
    "TRAIN_CONSTRUCTION": {
      "gapSeed": 42
    }
  },
  "scripts/marker-qualification/detector-expectations.mjs": {
    "createMinimumEpisodeVectors": {
      "kind": "fresh-literal-factory",
      "returns": {
        "1439": [
          0,
          1439,
          1919,
          0,
          2
        ],
        "1440": [
          0,
          1440,
          1920,
          0,
          2
        ],
        "1441": [
          0,
          1440,
          1441,
          0,
          1
        ]
      }
    },
    "MINIMUM_OBSERVATION_RULES": {
      "quietSamples": 480,
      "metadataRows": 2,
      "insufficientNominal": 1439,
      "tailNominal": 1441,
      "ordinaryBlocks": 4,
      "tailBlocks": 5
    }
  },
  "scripts/event-capacity-fixture-data.mjs": {
    "CAPACITY_FIXTURE": {
      "identityColors": {
        "a": "red",
        "b": "blue"
      },
      "videoSource": "testsrc2=size=1920x1080:rate=60[scene];testsrc=size=480x270:rate=60:decimals=2[clock];[scene][clock]overlay=x=1440:y=0",
      "marker": {
        "identityX": 0,
        "identityY": 0,
        "identityWidth": 128,
        "identityHeight": 128,
        "flashX": 128,
        "flashY": 0,
        "flashWidth": 128,
        "flashHeight": 128,
        "offColor": "black",
        "onColor": "white",
        "fill": "fill",
        "periodSeconds": 1,
        "onSeconds": 0.1
      },
      "audio": {
        "color": "white",
        "sampleRateHz": 48000,
        "amplitude": 0.12,
        "leftSeed": 42,
        "rightSeed": 43,
        "mergeInputs": 2,
        "carrierAmplitude": 0.65,
        "periodSeconds": 1,
        "onSeconds": 0.1,
        "layout": "stereo"
      },
      "output": {
        "durationText": "12",
        "videoCodec": "libx264",
        "threadsText": "2",
        "preset": "veryfast",
        "videoBitrate": "6000k",
        "maxrate": "6000k",
        "bufsize": "12000k",
        "gopText": "60",
        "pixelFormat": "yuv420p",
        "audioCodec": "aac",
        "audioBitrate": "320k",
        "channelsText": "2",
        "mux": "mpegts"
      },
      "expected": {
        "videoCodec": "h264",
        "width": 1920,
        "height": 1080,
        "frameRateText": "60/1",
        "audioCodec": "aac",
        "channels": 2,
        "sampleRateText": "48000",
        "fps": 60
      }
    }
  }
};
function assertFrozenTree(value) {
  if (value && typeof value === 'object') {
    assert(Object.isFrozen(value));
    Object.values(value).forEach(assertFrozenTree);
  }
}
for (const [path, exports] of Object.entries(expected)) test(`R93 whole DATA owner ${path}`, async () => {
  const module = await import(new URL('../../' + path, import.meta.url));
  for (const [name, value] of Object.entries(exports)) {
    if (value.kind === 'fresh-literal-factory') {
      const first = module[name](), second = module[name]();
      assert.deepEqual(first, value.returns);
      assert.deepEqual(second, first);
      assert.notEqual(first, second);
      assert(!Object.isFrozen(first));
      for (const key of Object.keys(first)) {
        assert.notEqual(first[key], second[key]);
        first[key].push(123);
        assert.deepEqual(second[key], value.returns[key]);
      }
    } else {
      assert.deepEqual(module[name], value);
      assertFrozenTree(module[name]);
    }
  }
  if (path === 'scripts/event-marker-program-contract.mjs') assert.equal(module.PROGRAM_SOURCE_CONTRACT, (await import('../../scripts/event-marker-program-guards.mjs')).PROGRAM_SOURCE_CONTRACT);
  if (!path.startsWith('workers/')) assert(!/\b(?:import|require)\s*[( {'"]/.test(await readFile(join(root,path),'utf8')));
});
test('R93 package includes all five whole DATA owners uniquely; workers import production settings', async () => {
  const manifest = JSON.parse(await readFile(join(root,'workers/restream/packaging-manifest.json')));
  assert.equal(manifest.length, 134);
  assert.equal(new Set(manifest).size, manifest.length);
  for (const path of Object.keys(expected)) assert(manifest.includes(path), path);
  assert(!manifest.includes('tests/scripts/event-marker-data-separation.test.mjs'));
  for (const path of ['input-supervisor','output-sender','program-renderer']) {
    const text = await readFile(join(root,`workers/restream/${path}.mjs`),'utf8');
    assert(!/from\s*['"][^'"]*(?:scripts|marker-qualification)/.test(text));
  }
});

// Optional retained-source differential run. The baseline is a complete,
// separately hashed pre-refactor tree; ordinary CI still runs the contracts above.
const baseline = process.env.R93_BASELINE;
const differential = (name, run) => test(name, {skip: !baseline}, run);
const plain = value => JSON.parse(JSON.stringify(value));
async function isolatedModules(directory) {
  const {SourceTextModule,SyntheticModule,createContext} = await import('node:vm');
  const {EventEmitter} = await import('node:events');
  const {readFileSync} = await import('node:fs');
  const {resolve,dirname} = await import('node:path');
  const {pathToFileURL} = await import('node:url');
  const timers = new Map(), calls = [];
  let time = 0, nextTimer = 0;
  const child = () => {
    const c = new EventEmitter();
    c.exitCode = 0; c.signalCode = null;
    c.stdio = Array.from({length:8}, () => Object.assign(new EventEmitter(), {
      writes: [], writableLength: 0,
      write(bytes) { this.writes.push(bytes); return true; }, end() {}, destroy() {},
    }));
    c.stdout = c.stdio[1]; c.stderr = c.stdio[2];
    c.kill = () => { c.emit('close', 0); return true; };
    return c;
  };
  const spawn = (command,args,options) => {
    const c = child(); calls.push({command,args:plain(args),options:plain(options),child:c}); return c;
  };
  const deny = () => { throw Error('Native/process effects forbidden by R93 source test'); };
  const context = createContext({Buffer,Uint8Array,TextDecoder,TextEncoder,URL,URLSearchParams,
    AbortController,AbortSignal,structuredClone,console,performance:{now:()=>time},
    process:{versions:process.versions,execPath:process.execPath,execArgv:process.execArgv,pid:process.pid,env:{},kill:deny},
    setTimeout(fn) { const id=++nextTimer; timers.set(id,fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id=++nextTimer; timers.set(id,fn); return id; },
    clearInterval(id) { timers.delete(id); },
    setImmediate:queueMicrotask,queueMicrotask,
  });
  const cache = new Map();
  const get = async identifier => {
    if(cache.has(identifier)) return cache.get(identifier);
    if(identifier.startsWith('node:')) {
      const values = identifier==='node:child_process' ? {spawn,execFile:deny,exec:deny,spawnSync:deny,execFileSync:deny}
        : identifier==='node:readline' ? {createInterface:()=>new EventEmitter()}
        : identifier==='node:perf_hooks' ? {performance:{now:()=>time}}
        : await import(identifier);
      const module = new SyntheticModule(Object.keys(values), function() {
        for(const [key,value] of Object.entries(values)) this.setExport(key,value);
      }, {context,identifier});
      cache.set(identifier,module); return module;
    }
    const module = new SourceTextModule(readFileSync(identifier,'utf8'),{context,identifier,initializeImportMeta(meta){meta.url=pathToFileURL(identifier).href;}});
    cache.set(identifier,module); return module;
  };
  const link = async (specifier,parent) => get(specifier.startsWith('node:')?specifier:resolve(dirname(parent.identifier),specifier));
  return {calls,timers,spawn,clock:()=>time,
    async load(path) { const m=await get(resolve(directory,path)); if(m.status==='unlinked')await m.link(link); if(m.status==='linked')await m.evaluate(); return m.namespace; },
    tick(ms) { time=ms; const pending=[...timers.values()]; timers.clear(); pending.forEach(fn=>fn()); },
  };
}
const sha256 = async bytes => (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
const evidence = {};
async function recordEvidence(name, value) {
  evidence[name]=value;
  if(process.env.R93_EVIDENCE) {
    const {writeFile}=await import('node:fs/promises');
    await writeFile(process.env.R93_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  }
}

differential('R93 retained-source complete encoder/output/local argv, defaults, getters and factory errors', async () => {
  const before=await isolatedModules(baseline),after=await isolatedModules(root), all=[];
  const modules=await Promise.all([before,after].map(async vm=>({
    renderer:await vm.load('workers/restream/program-renderer.mjs'),
    profiles:await vm.load('workers/restream/broadcast-profiles.mjs'),
    output:await vm.load('workers/restream/output-sender.mjs'),
    codec:await vm.load('scripts/marker-qualification/codec-io.mjs'),
  })));
  for(const m of modules) {
    assert.equal(m.renderer.QUALITY_PROFILES,m.profiles.VIDEO_PROFILES);
    const a=m.profiles.parseMediaSettings(),b=m.profiles.parseMediaSettings(undefined);
    assert.deepEqual(plain(a),{videoPreset:'720p30',audioBitrateKbps:160}); assert.notEqual(a,b); assert(!Object.isFrozen(a)); a.audioBitrateKbps=320;assert.equal(b.audioBitrateKbps,160);
    for(const destination of ['vrcdn','twitch']) {
      const x=m.profiles.resolveDestinationProfile({destination}),y=m.profiles.resolveDestinationProfile({destination});
      assert.notEqual(x,y);assert(Object.isFrozen(x));assert.deepEqual(plain(x),plain(y));
    }
    assert.throws(()=>m.renderer.createProgramRenderer(null));
    assert.throws(()=>m.renderer.createProgramRenderer({quality:null}));
    assert.throws(()=>m.renderer.createProgramRenderer({audioBitrateKbps:null}));
    assert.throws(()=>m.profiles.parseMediaSettings(null));
  }
  const target={url:'rtmp://example.invalid/app',key:'synthetic_qualification'};
  for(const settings of [undefined,...Object.keys(modules[0].profiles.VIDEO_PROFILES).flatMap(videoPreset=>[160,320].map(audioBitrateKbps=>({videoPreset,audioBitrateKbps})))]) {
    const pair=modules.map(m=>plain(m.renderer.programEncoderArguments(settings)));assert.deepEqual(pair[1],pair[0]);all.push({kind:'encoder',settings:settings??null,args:pair[0]});
    const args=modules[1].renderer.programEncoderArguments(settings);assert.notEqual(args,modules[1].renderer.programEncoderArguments(settings));args.push('mutable');
    for(const destination of ['vrcdn','twitch']) {
      const observed=modules.map(m=>{
        const profile=m.profiles.resolveDestinationProfile({settings,destination}), reads=[];
        const getters=Object.fromEntries(Object.keys(profile).map(key=>[key,{enumerable:true,get(){reads.push(key);return profile[key];}}]));
        const args=m.output.outputArguments(destination,target,Object.defineProperties({},getters));return {args:plain(args),reads};
      });assert.deepEqual(observed[1],observed[0]);all.push({kind:destination,settings:settings??null,...observed[0]});
      assert.deepEqual(plain(modules[1].output.outputArguments(destination,target)),plain(modules[0].output.outputArguments(destination,target)));
      assert.throws(()=>modules[1].output.outputArguments(destination,target,null));
    }
    const local=modules.map(m=>plain(m.codec.localTwitchArguments(settings)));assert.deepEqual(local[1],local[0]);all.push({kind:'local-twitch',settings:settings??null,...local[0]});
  }
  await recordEvidence('argv',{sha256:await sha256(JSON.stringify(all)),records:all});
});

differential('R93 retained-source capacity fixture and native noise complete argv with independent fake probe/capture', async () => {
  const all=[];
  for(const id of ['a','b',Object('a'),Object('b')]) {
    const outcomes=[];
    for(const directory of [baseline,root]) {
      const vm=await isolatedModules(directory),m=await vm.load('scripts/event-capacity-media.mjs'),calls=[];
      const facts={streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080,r_frame_rate:'60/1'},{codec_type:'audio',codec_name:'aac',channels:2,sample_rate:'48000'}]};
      const owner={run:async(command,args,options)=>{calls.push({command,args:plain(args),options:plain(options)});return Buffer.from(JSON.stringify(facts));}};
      const result=await m.createFixture(owner,'SIMULATED.ts',id);outcomes.push({calls,result:plain(result)});
      facts.streams[0].width=1919;await assert.rejects(m.createFixture(owner,'SIMULATED.ts',id),/Input fixture/);
      await assert.rejects(m.createFixture(owner,'SIMULATED.ts','other'),/marker_fixture_identity/);
    }
    assert.deepEqual(outcomes[1],outcomes[0]);all.push({id,idType:typeof id,...outcomes[0]});
  }
  for(const rate of [44100,48000])for(const count of [1,1439,1440,1441,1190400]) {
    const outcomes=[];
    for(const directory of [baseline,root]) {
      const vm=await isolatedModules(directory),m=await vm.load('scripts/marker-qualification/codec-io.mjs'),calls=[],captures=[],signal=new AbortController().signal;
      const result=await m.generateNoise({run:async(command,args,options)=>{
        assert.equal(options.signal,signal);options.observeCapture({complete:true});
        calls.push({command,args:plain(args),timeoutMs:options.timeoutMs,maxBytes:options.maxBytes});return Buffer.alloc(count*2,calls.length);
      }},rate,count,{signal,observeCapture:(seed,data)=>captures.push({seed,...data})});
      assert.equal(result[42].length,count*2);assert.equal(result[43].length,count*2);
      outcomes.push({calls,captures,hashes:await Promise.all([sha256(result[42]),sha256(result[43])])});
      await assert.rejects(m.generateNoise({run:async()=>Buffer.alloc(0)},rate,count),/noise_extent/);
      for(const bad of [0,-1,1190401,null,NaN])await assert.rejects(m.generateNoise({run:()=>assert.fail('invalid request ran')},rate,bad),/noise_request/);
    }
    assert.deepEqual(outcomes[1],outcomes[0]);all.push({rate,count,...outcomes[0]});
  }
  await recordEvidence('fixturesNoise',{sha256:await sha256(JSON.stringify(all)),records:all});
});

differential('R93 retained-source six hold frames compare every byte, isolated backing stores and per-instance reuse', async () => {
  const observations=[];
  for(const quality of ['480p30','480p60','720p30','720p60','1080p30','1080p60']) {
    const captures=[];
    for(const directory of [baseline,root]) {
      const vm=await isolatedModules(directory),m=await vm.load('workers/restream/program-renderer.mjs');
      const a=m.createProgramRenderer({quality,clock:vm.clock}),b=m.createProgramRenderer({quality,clock:vm.clock});
      await a.start();await b.start();const first=vm.calls[0].child.stdio[3].writes[0],other=vm.calls[1].child.stdio[3].writes[0];
      assert.notEqual(first,other);assert.notEqual(first.buffer,other.buffer);assert.deepEqual(first,other);
      captures.push(Buffer.from(first));const keep=other[0];first[0]^=255;assert.equal(other[0],keep);
      vm.tick(1000/a.profile.frameRate+1);assert.equal(vm.calls[0].child.stdio[3].writes[1],first);assert.equal(vm.calls[1].child.stdio[3].writes[1],other);
      await a.stop();await b.stop();assert.equal(vm.timers.size,0);
    }
    assert.deepEqual(captures[1],captures[0]);observations.push({quality,bytes:captures[0].length,sha256:await sha256(captures[0])});
  }
  await recordEvidence('holdFrames',observations);
});

differential('R93 retained-source input factory omitted/undefined/null and supplied quality late reads', async () => {
  const outcomes=[];
  for(const directory of [baseline,root]) {
    const vm=await isolatedModules(directory),m=await vm.load('workers/restream/input-supervisor.mjs'),results=[];
    assert.throws(()=>m.createInputSupervisor(null));assert.throws(()=>m.createInputSupervisor({quality:null}));
    for(const options of [{},{quality:undefined}]) {
      const a=m.createInputSupervisor({source:{url:'SIMULATED',slotKey:'a'},...options}),b=m.createInputSupervisor({source:{url:'SIMULATED',slotKey:'b'},...options});
      assert.notEqual(a.buffer,b.buffer);assert.equal(a.buffer.frameBytes,1280*720*3/2);a.start();b.start();results.push(vm.calls.slice(-2).map(c=>c.args));await a.stop();await b.stop();
    }
    const quality={width:854,height:480,frameRate:30},reads=[];
    const watched=new Proxy(quality,{get(object,key){reads.push(key);return object[key];}});
    const supplied=m.createInputSupervisor({source:{url:'SIMULATED'},quality:watched});quality.width=1280;quality.height=720;supplied.start();
    assert(!Object.isFrozen(quality));assert.equal(supplied.buffer.frameBytes,854*480*3/2);assert(vm.calls.at(-1).args.some(x=>x.includes('scale=1280:720')));
    results.push({args:vm.calls.at(-1).args,reads});await supplied.stop();assert.equal(vm.timers.size,0);outcomes.push(results);
  }
  assert.deepEqual(outcomes[1],outcomes[0]);await recordEvidence('inputFactories',outcomes[0]);
});

differential('R93 retained-source full PCM families/defaults/boundaries and unchanged 636-frame canary', async () => {
  const before=await isolatedModules(baseline),after=await isolatedModules(root);
  const [oldSignals,newSignals]=await Promise.all([before.load('scripts/marker-qualification/signals.mjs'),after.load('scripts/marker-qualification/signals.mjs')]);
  const records=[];
  const families=['hidden105','hidden105_literal','unknown1000','1000Hz','phasejump','phasejump_literal','foreign','foreign_literal','q30','q30offset','eq30','mixture_literal','missing','clean'];
  const configurations=[];
  for(const family of families)for(const source of ['a','b'])for(const placement of ['prefix','center','suffix',0,480])configurations.push({family,source,placement,durationMs:30,jump:2,phase:1,foreignPhase:2});
  for(const key of ['source','phase','foreignPhase','placement','durationMs','jump','ratio','loudSamples'])for(const value of [undefined,null,0])configurations.push({family:'foreign',...{[key]:value}});
  for(const options of configurations) {
    const outputs=[oldSignals,newSignals].map(m=>m.literalPcm(options));assert.deepEqual(plain(outputs[1].rows),plain(outputs[0].rows));assert.deepEqual(outputs[1].pcm,outputs[0].pcm);
    assert.equal(outputs[1].actualToneStart,outputs[0].actualToneStart);assert.equal(outputs[1].actualToneEnd,outputs[0].actualToneEnd);
    records.push({options,bytes:outputs[0].pcm.length,sha256:await sha256(outputs[0].pcm)});
  }
  for(const pulseSamples of [1439,1440,1441,0,null,undefined])for(const noise of ['none','42','43'])for(const source of ['a','b']) {
    const options={family:'clean',source},config={onset:0,tail:480,rowSamples:1440,pulseSamples,noise};
    const a=oldSignals.literalPcm(options,config),b=newSignals.literalPcm(options,config);assert.deepEqual(a.pcm,b.pcm);assert.deepEqual(plain(a),plain(b));records.push({options,config,bytes:a.pcm.length,sha256:await sha256(a.pcm)});
  }
  for(const config of [undefined,null,{onset:undefined},{onset:null},{tail:null},{rowSamples:undefined},{noise:null}]) {
    const invoke=m=>{try{const x=m.literalPcm({family:'clean'},config);return {value:plain(x)};}catch(e){return {error:e.name,message:e.message};}};
    assert.deepEqual(invoke(newSignals),invoke(oldSignals));
  }
  const oldTrain=await before.load('scripts/marker-qualification/train-construction.mjs'),newTrain=await after.load('scripts/marker-qualification/train-construction.mjs');
  const {enumerateQualification}=await import('../../scripts/marker-qualification/authority.mjs');
  const {compileTrain}=await import('../../scripts/marker-qualification/trains.mjs');
  const inv=enumerateQualification().invocations.find(x=>x.id==='mass-320-48000stereo-073'),canary=compileTrain(inv);
  assert.equal(canary.frames,636);assert.equal(canary.samples,1017600);assert.equal(canary.slots.length,64);
  const oldCompile=await before.load('scripts/marker-qualification/trains.mjs');assert.equal(JSON.stringify(oldCompile.compileTrain(inv)),JSON.stringify(canary));
  const trains=[canary,...[44100,48000].map(sourceRate=>({sourceRate,samples:12000,frames:8,slots:[{start:1000,end:5000,sourceStart:Math.round(1000*sourceRate/48000),family:'clean',params:{seed:43,source:'b'}},{start:6000,end:8000,sourceStart:Math.round(6000*sourceRate/48000),family:'missing',params:{seed:42,kind:'silence'}}]}))];
  const pcm=[];
  for(const train of trains) {
    const count=Math.round(train.samples*train.sourceRate/48000),noise={42:Buffer.alloc(count*2),43:Buffer.alloc(count*2)};
    for(let i=0;i<count;i++){noise[42].writeInt16LE(i%2?32767:-32768,i*2);noise[43].writeInt16LE((i*7919)%65536-32768,i*2);}
    const a=oldTrain.constructTrainPcm(train,noise),b=newTrain.constructTrainPcm(train,noise);assert.deepEqual(a,b);assert.notEqual(a,b);pcm.push({rate:train.sourceRate,bytes:a.length,sha256:await sha256(a)});
    assert.throws(()=>newTrain.constructTrainPcm(train,{42:noise[42],43:noise[43].subarray(2)}),/noise_extent/);
  }
  const oldFrames=(await before.load('scripts/marker-qualification/codec-input.mjs')).massFrames(canary),newFrames=(await after.load('scripts/marker-qualification/codec-input.mjs')).massFrames(canary);
  const {createHash}=await import('node:crypto'),digest=createHash('sha256');let frames=0,bytes=0;
  for(const a of oldFrames){const next=newFrames.next();assert(!next.done);assert.deepEqual(next.value,a);digest.update(a);bytes+=a.length;frames++;}
  assert(newFrames.next().done);assert.equal(frames,636);
  await recordEvidence('pcmAndFrames',{literalRecords:records,trainPcm:pcm,canaryConstructionSHA256:await sha256(JSON.stringify({kind:'massFrames',train:canary})),frames:{count:frames,bytes,sha256:digest.digest('hex')}});
});

import { collectImplementationCatalog,compactImplementationCatalog,expandImplementationCatalog,validateImplementationCatalog,verifyImplementationSource,IMPLEMENTATION_ROOTS,PROGRAM_BUILTINS } from '../../scripts/event-marker-implementation-assets.mjs';
import { simulatedProgramRuntime } from '../fixtures/marker-positive-program.mjs';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value));
const dataPaths = Object.keys(expected);
const reservation = files => ({kind:'implementationCode-v1',bytes:files.reduce((sum,f)=>sum+f.bytes,0)});

test('R93 all five DATA bodies survive catalog roundtrip, forced-kind rejection and whole acquisition', async () => {
  const audit={kind:'audit',id:'SIMULATED-R93-review',bytes:1,sha256:hash('S')};
  const catalog=await collectImplementationCatalog({roots:IMPLEMENTATION_ROOTS,approvedBuiltins:PROGRAM_BUILTINS,sourceAuditRef:audit,read:path=>readFile(join(root,path))});
  const compact=compactImplementationCatalog(catalog);assert.deepEqual(expandImplementationCatalog(compact),catalog);
  const runtime=await simulatedProgramRuntime();let registered=false;
  const get=runtime.files.get.bind(runtime.files);
  runtime.files.get=path=>{if(catalog.files.some(f=>path==='/app/'+f.path))assert(registered,'reserve complete code union before source reads');return get(path);};
  const binding=await runtime.dependencies({registerImplementationAssets:files=>{registered=true;assert(!files.some(f=>dataPaths.includes(f.path)));return reservation(files);}});
  assert.equal(binding.kind,'AcquiredDependencies');assert.equal(binding.assurance.nativeBindingVerified,false);assert.equal(binding.assurance.loaderComplete,false);
  for(const path of dataPaths) {
    const entry=catalog.files.find(f=>f.path===path),raw=await readFile(join(root,path));
    assert.equal(entry.kind,'runtimeData');assert.equal(entry.bytes,raw.length);assert.equal(entry.sha256,hash(raw));
    assert.equal(compact.files[compact.paths.indexOf(path)][1],1);
    const acquired=binding.artifacts.find(a=>a.id==='loaded-data:'+path);assert(acquired);assert.equal(acquired.bytes,raw.length);assert.deepEqual(Buffer.from(acquired.data,'base64'),raw);
    assert.throws(()=>validateImplementationCatalog({...catalog,files:catalog.files.map(f=>f===entry?{...f,kind:'implementationCode'}:f)}),/eligibility/);
    assert.throws(()=>verifyImplementationSource({...entry,kind:'implementationCode'},raw,catalog),/data_disguised/);
    assert.throws(()=>validateImplementationCatalog({...catalog,files:catalog.files.filter(f=>f!==entry)}),/closure/);
  }
  const extra=structuredClone(catalog),code=extra.files.find(f=>f.kind==='implementationCode');code.kind='runtimeData';assert(validateImplementationCatalog(extra).includes(code),'additional DATA classifications remain supported');
});

test('R93 changed, truncated, absent and non-EOF whole DATA originals fail acquisition', async () => {
  for(const path of dataPaths)for(const mutation of ['changed','truncated','missing','hash-only','non-EOF']) {
    const runtime=await simulatedProgramRuntime(),absolute='/app/'+path,original=runtime.files.get(absolute);
    if(mutation==='missing') runtime.files.delete(absolute);
    else if(mutation==='non-EOF') {
      const get=runtime.files.get.bind(runtime.files);
      // Observe the real identity check through the reader boundary below.
      const {openNativeBindingDependencies}=await import('../../scripts/event-marker-native-binding.mjs');
      const context=JSON.parse(get('/run/vrdex-native/context.json')),intent=JSON.parse(context.intent.utf8);
      await assert.rejects(openNativeBindingDependencies({environment:{...intent.semanticEnvironment,VRDEX_NATIVE_BINDING_CONTEXT_B64:get('/run/vrdex-native/context.json').toString('base64')},registerImplementationAssets:reservation,read:async p=>{
        const b=Buffer.from(get(p));b.bindingIdentity={path:p,regular:true,symlink:false,bytes:b.length,nlink:1,dev:'85',ino:'1',mtimeMs:0,ctimeMs:0,eof:p!==absolute};return b;
      }}),/implementation_identity/);continue;
    } else runtime.files.set(absolute,mutation==='truncated'?original.subarray(0,-1):mutation==='hash-only'?Buffer.from(hash(original)):Buffer.from(original.map((b,i)=>i===0?b^1:b)));
    if(mutation==='missing') {const b=await runtime.dependencies({registerImplementationAssets:reservation});assert.equal(b.kind,'Unproven');assert(b.missing.includes('runtime_input'));}
    else await assert.rejects(runtime.dependencies({registerImplementationAssets:reservation}),error=>{
      assert.match(error.message,/source_hash/);const failed=error.bindingArtifacts.find(a=>a.id==='failed-source:'+path);assert(failed);assert.deepEqual(Buffer.from(failed.data,'base64'),runtime.files.get(absolute));return true;
    });
  }
});

function rebindSimulatedClosure(runtime) {
  const prefix='/app/workers/restream/native-binding/runtime/',closure=jsonBytes(compactImplementationCatalog(runtime.closure));
  runtime.files.set(prefix+'closure.json',closure);
  const manifest=JSON.parse(runtime.files.get(prefix+'manifest.json')),entry=manifest.entries.find(e=>e.id==='closure');entry.bytes=closure.length;entry.sha256=hash(closure);
  const manifestBytes=jsonBytes(manifest);runtime.files.set(prefix+'manifest.json',manifestBytes);
  const context=JSON.parse(runtime.files.get('/run/vrdex-native/context.json')),intent=JSON.parse(context.intent.utf8);intent.observerClosureSHA=hash(closure);intent.runtimeManifestSHA=hash(manifestBytes);
  const raw=jsonBytes(intent);context.intent={utf8:raw.toString(),bytes:raw.length,sha256:hash(raw)};runtime.files.set('/run/vrdex-native/context.json',jsonBytes(context));
}
test('R93 charged whole DATA reaches bootstrap exactly and one byte over rejects at unchanged 196608', async () => {
  const runtime=await simulatedProgramRuntime(),path='scripts/marker-qualification/detector-expectations.mjs',absolute='/app/'+path,original=runtime.files.get(absolute),entry=runtime.closure.files.find(f=>f.path===path);
  const acquire=()=>runtime.dependencies({registerImplementationAssets:reservation});
  let padding=0,binding=await acquire();
  for(let i=0;i<5;i++) {
    const retained=binding.artifacts.reduce((sum,a)=>sum+a.bytes,0);if(retained===196608)break;
    padding+=196608-retained;
    // Account for decimal-length growth in closure and containing manifests.
    const raw=Buffer.concat([original,Buffer.alloc(Math.max(0,padding-32),32)]);runtime.files.set(absolute,raw);entry.bytes=raw.length;entry.sha256=hash(raw);rebindSimulatedClosure(runtime);
    binding=await acquire();padding-=32;
  }
  let retained=binding.artifacts.reduce((sum,a)=>sum+a.bytes,0);
  const raw=Buffer.concat([runtime.files.get(absolute),Buffer.alloc(196608-retained,32)]);runtime.files.set(absolute,raw);entry.bytes=raw.length;entry.sha256=hash(raw);rebindSimulatedClosure(runtime);
  binding=await acquire();assert.equal(binding.artifacts.reduce((sum,a)=>sum+a.bytes,0),196608);assert.equal(binding.artifacts.find(a=>a.id==='loaded-data:'+path).bytes,raw.length);
  const over=Buffer.concat([raw,Buffer.from(' ')]);runtime.files.set(absolute,over);entry.bytes=over.length;entry.sha256=hash(over);rebindSimulatedClosure(runtime);
  await assert.rejects(acquire(),/marker_binding_bound/);
});

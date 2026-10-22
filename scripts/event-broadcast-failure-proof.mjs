import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { FFmpegProcess, sleep } from '../workers/restream/live-control.mjs';
await mkdir('/tmp/event-broadcast-proof', { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
export function feed(port, color, frequency) {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=${color}:s=640x360:r=30,drawtext=text='${color} source':fontsize=48:fontcolor=white:x=30:y=30`, '-re', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`, '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', `udp://127.0.0.1:${port}?pkt_size=1316`], { stdio: 'ignore' });
    return child;
}
// ctypes uses the FFmpeg build's native libzmq; no Python package installation required.
async function zmqCommand(message) {
    const python = String.raw `
import ctypes as c, ctypes.util, sys
z=c.CDLL(ctypes.util.find_library('zmq'))
z.zmq_ctx_new.restype=c.c_void_p
z.zmq_socket.argtypes=[c.c_void_p,c.c_int]; z.zmq_socket.restype=c.c_void_p
z.zmq_connect.argtypes=[c.c_void_p,c.c_char_p]
z.zmq_setsockopt.argtypes=[c.c_void_p,c.c_int,c.c_void_p,c.c_size_t]
z.zmq_send.argtypes=[c.c_void_p,c.c_void_p,c.c_size_t,c.c_int]
z.zmq_recv.argtypes=[c.c_void_p,c.c_void_p,c.c_size_t,c.c_int]
z.zmq_close.argtypes=[c.c_void_p];z.zmq_ctx_term.argtypes=[c.c_void_p]
ctx=z.zmq_ctx_new(); sock=z.zmq_socket(ctx,3)
timeout=c.c_int(2000);zero=c.c_int(0)
z.zmq_setsockopt(sock,27,c.byref(timeout),4);z.zmq_setsockopt(sock,17,c.byref(zero),4)
z.zmq_connect(sock,b'tcp://127.0.0.1:5555')
message=sys.argv[1].encode();z.zmq_send(sock,message,len(message),0)
buf=c.create_string_buffer(1024);n=z.zmq_recv(sock,buf,1024,0)
print(buf.raw[:n].decode() if n>=0 else 'timed out waiting for FFmpeg ZMQ response')
z.zmq_close(sock);z.zmq_ctx_term(ctx)
`;
    return new Promise((resolve, reject) => execFile('python3', ['-c', python, message], { timeout: 5000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim())));
}
async function baseline() {
    const a = feed(19331, 'red', 440), b = feed(19332, 'blue', 880);
    const graph = ['[0:v]fps=30,format=yuv420p,setsar=1[v0]', '[1:v]fps=30,format=yuv420p,setsar=1[v1]', '[2:v]fps=30,format=yuv420p,setsar=1[v2]', '[v0][v1][v2]streamselect@video-source=inputs=3:map=0,zmq[v]', '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]', '[3:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a1]', '[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a2]', '[a0][a1][a2]astreamselect@audio-source=inputs=3:map=0,aresample=48000[a]'].join(';');
    const proc = new FFmpegProcess(['-hide_banner', '-loglevel', 'warning', '-stats_period', '0.25', '-progress', 'pipe:1', '-i', 'udp://127.0.0.1:19331', '-re', '-f', 'lavfi', '-i', 'color=gray:s=640x360:r=30', '-i', 'udp://127.0.0.1:19332', '-re', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-f', 'null', '-'], { command: ffmpeg });
    try {
        await sleep(14000);
        assert(proc.getProgressMs() > 0, 'POC must first demonstrate live output');
        assert.match(await zmqCommand('streamselect@video-source map 0'), /^0/, 'control responds before source loss');
        a.kill('SIGSTOP');
        b.kill('SIGSTOP');
        await sleep(5000);
        const before = proc.getProgressMs();
        const response = await zmqCommand('streamselect@video-source map 1');
        await sleep(3000);
        const after = proc.getProgressMs();
        const result = { kind: 'existing-poc', before, after, advanceMs: after - before, response, stderr: proc.stderr.slice(-250) };
        console.log(JSON.stringify(result, null, 2));
        await writeFile('/tmp/event-broadcast-proof/baseline.json', JSON.stringify(result, null, 2));
        assert(after - before < 1000, 'Expected stalled POC to reproduce input failure');
    }
    finally {
        a.kill('SIGKILL');
        b.kill('SIGKILL');
        proc.child.kill('SIGKILL');
    }
}
if (process.argv.includes('--baseline'))
    await baseline();
async function isolated() {
    const { createProgramRenderer } = await import('../workers/restream/program-renderer.mjs');
    const { createWriteStream } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const duration = Number(process.env.PROOF_SECONDS ?? 180), scale = duration / 180;
    const quality = process.env.PROOF_QUALITY ?? '720p30';
    const port = Number(process.env.PROOF_PORT_BASE ?? 19341);
    const path = `/tmp/event-broadcast-proof/${quality}-${duration}.ts`;
    const output = createWriteStream(path);
    const samples = [], observations = [], events = [];
    let a = feed(port, 'red', 440), b = feed(port + 1, 'blue', 880);
    const renderer = createProgramRenderer({ quality, onProgress: s => samples.push(s), onObservation: o => {
            if (observations.length > 4000)
                observations.shift();
            observations.push(o);
        } });
    renderer.subscribe(chunk => { assert(output.writableLength < 8 * 1024 * 1024, 'proof sink stays bounded'); output.write(chunk); });
    const source = (slotKey, port) => ({ slotKey, sourceId: slotKey, url: `udp://127.0.0.1:${port}?fifo_size=1024&overrun_nonfatal=1` });
    let started = performance.now();
    const until = async (seconds) => { await sleep(Math.max(0, started + seconds * 1000 * scale - performance.now())); assert.equal(renderer.getState().error, undefined); };
    const select = slot => { assert(renderer.selectSource(slot), `${slot} has fresh decoded audio/video`); events.push({ at: (performance.now() - started) / 1000, select: slot }); };
    try {
        await renderer.reconcileSources([source('a', port), source('b', port + 1)]);
        await renderer.start();
        started = performance.now();
        await until(15);
        select('a');
        await until(30);
        a.kill('SIGKILL');
        events.push({ at: 30 * scale, kill: 'a' });
        await until(40);
        assert(!renderer.getInputs()[0].getObservation().ready);
        renderer.hold();
        b.kill('SIGSTOP');
        events.push({ at: 40 * scale, stall: 'b' });
        await until(55);
        assert(!renderer.getInputs()[1].getObservation().ready, 'stalled next is not ready');
        assert(!renderer.selectSource('b'));
        b.kill('SIGCONT');
        events.push({ at: 55 * scale, recover: 'b' });
        await until(75);
        select('b');
        a = feed(port, 'red', 440);
        await until(100);
        select('a');
        await until(115);
        select('b');
        await until(130);
        renderer.hold();
        events.push({ at: 130 * scale, hold: true });
        await until(140);
        select('a');
        await until(155);
        select('b');
        await until(165);
        assert.equal(renderer.getState().renderedSlotKey, 'b');
        await renderer.reconcileSources([source('b', port + 1)]);
        assert.equal(renderer.getInputs().length, 1);
        await until(180);
    }
    finally {
        a.kill('SIGKILL');
        b.kill('SIGKILL');
        await renderer.stop();
        await new Promise(resolve => output.end(resolve));
    }
    assert(samples.length > duration, 'encoder emits continuous measured progress');
    assert(samples.at(-1).outputMs > duration * 1000 - 3000);
    for (let i = 1; i < samples.length; i++) {
        assert(samples[i].outputMs >= samples[i - 1].outputMs, 'no encoder timestamp regression');
        assert(samples[i].wallElapsedMs - samples[i - 1].wallElapsedMs < 3000, 'no program progress stall');
    }
    const maxDelayMs = Math.max(...samples.map(s => s.delayMs));
    assert(maxDelayMs < 10000);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_packets', '-show_entries', 'packet=stream_index,dts_time,flags:stream=codec_name,width,height,r_frame_rate', '-of', 'json', path], { maxBuffer: 64 * 1024 * 1024 }));
    const last = new Map();
    for (const packet of probe.packets) {
        const timestamp = Number(packet.dts_time);
        if (!Number.isFinite(timestamp))
            continue;
        assert(timestamp >= (last.get(packet.stream_index) ?? -Infinity));
        last.set(packet.stream_index, timestamp);
    }
    const keyframes = probe.packets.filter(packet => packet.stream_index === 0 && packet.flags.includes('K')).map(packet => Number(packet.dts_time));
    const maxKeyframeInterval = Math.max(...keyframes.slice(1).map((time, index) => time - keyframes[index]));
    assert(maxKeyframeInterval <= 1.05, 'VRCDN one-second keyframe interval');
    const pixelAt = seconds => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds * scale), '-i', path, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    const hold = pixelAt(50), red = pixelAt(22), blue = pixelAt(85);
    assert(red[0] > red[2] + 50, 'actual source A red pixels reached program');
    assert(blue[2] > blue[0] + 50, 'actual recovered source B blue pixels reached program');
    assert(Math.max(...hold) - Math.min(...hold) < 15, 'hold visible during source loss');
    const rmsAt = seconds => {
        const pcm = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(seconds * scale), '-i', path, '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1']);
        let sum = 0;
        for (let i = 0; i < pcm.length; i += 2)
            sum += (pcm.readInt16LE(i) / 32768) ** 2;
        return Math.sqrt(sum / (pcm.length / 2));
    };
    const holdRms = rmsAt(50), recoveredRms = rmsAt(85);
    assert(holdRms < 0.001);
    assert(recoveredRms > 0.02, 'recovered input audio is audible');
    const result = { kind: 'isolated-render-clock', quality, duration, output: path, maxDelayMs, maxKeyframeInterval, progressSamples: samples.length, finalOutputMs: samples.at(-1).outputMs, hold: [...hold], red: [...red], blue: [...blue], holdRms, recoveredRms, events, streams: probe.streams };
    await writeFile(`/tmp/event-broadcast-proof/${quality}-${duration}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
}
if (!process.argv.includes('--baseline'))
    await isolated();

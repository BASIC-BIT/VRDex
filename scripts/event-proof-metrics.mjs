import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, readdir } from 'node:fs/promises';

/** Packet verification is constant-memory regardless of event duration. */
export async function verifyProgramPackets(path) {
    const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,sample_rate', '-of', 'json', path], { maxBuffer: 65536 })).streams;
    const child = spawn('ffprobe', ['-v', 'error', '-show_packets', '-show_entries', 'packet=stream_index,dts_time,flags', '-of', 'csv=p=0', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '', maxGap = 0, maxGop = 0, lastKey, packets = 0;
    const last = new Map();
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2048); });
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error(`ffprobe failed (${code}): ${diagnostic}`))); });
    try {
        for await (const line of createInterface({ input: child.stdout })) {
            const [index, dts, flags] = line.split(',');
            const time = Number(dts);
            if (!dts || !Number.isFinite(time)) continue;
            const previous = last.get(index);
            if (previous !== undefined) { assert(time >= previous, 'program DTS is monotonic'); maxGap = Math.max(maxGap, time - previous); }
            last.set(index, time);
            if (index === '0' && flags?.includes('K')) { if (lastKey !== undefined) maxGop = Math.max(maxGop, time - lastKey); lastKey = time; }
            packets++;
        }
        await closed;
        assert(packets > 0);
        return { streams, packets, maxGap, maxGop };
    } finally { child.kill('SIGKILL'); }
}

/** Linux process-tree samples include the controller, renderer, decoder and senders.
 * Test generators and receivers are classified separately. Dead processes retain
 * their last sample; CPU is a measured lower bound (up to one sample lost at exit).
 */
export function processMetrics(excluded, senderPids) {
    const records = new Map(), peakRssBytes = {};
    const ticksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
    async function sample() {
        const rss = {};
        const processes = new Map();
        await Promise.all((await readdir('/proc')).filter(id => /^\d+$/.test(id)).map(async id => {
            try {
                const raw = await readFile(`/proc/${id}/stat`, 'utf8');
                const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
                processes.set(Number(id), { parent: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]), bytes: Number(fields[21]) * 4096 });
            } catch { /* A process may exit while enumerating. */ }
        }));
        function visit(pid, inherited = 'worker') {
            const value = processes.get(pid);
            if (!value) return;
            const group = excluded.get(pid) ?? inherited;
            records.set(pid, { group, ticks: value.ticks, sender: senderPids.get(pid) });
            rss[group] = (rss[group] ?? 0) + value.bytes;
            for (const [id, child] of processes) if (child.parent === pid) visit(id, group);
        }
        visit(process.pid);
        for (const [group, bytes] of Object.entries(rss)) peakRssBytes[group] = Math.max(peakRssBytes[group] ?? 0, bytes);
    }
    return { sample, result() {
        const cpuSeconds = {}, senderCpuSeconds = {};
        for (const record of records.values()) {
            cpuSeconds[record.group] = (cpuSeconds[record.group] ?? 0) + record.ticks / ticksPerSecond;
            if (record.sender) senderCpuSeconds[record.sender] = (senderCpuSeconds[record.sender] ?? 0) + record.ticks / ticksPerSecond;
        }
        return { cpuSeconds, senderCpuSeconds, peakRssBytes, sampledProcesses: records.size, sampleIntervalMs: 1000, cpuMeasurement: 'Last sampled per-process CPU; lower bound at process exit. Worker includes Node proof/control harness, encoder, decoders and both senders; generators/receivers excluded. RSS is peak sampled sum, not cgroup memory.' };
    } };
}

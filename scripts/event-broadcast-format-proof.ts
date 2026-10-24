import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { programEncoderArguments } from '../workers/restream/program-renderer.mjs';
import { VIDEO_PROFILES, resolveDestinationProfile } from '../workers/restream/broadcast-profiles.mjs';
import { outputArguments } from '../workers/restream/output-sender.mjs';

async function main() {
    const directory = await mkdtemp('/tmp/broadcast-formats-');
    const results: object[] = [];
    // This serial offline proof verifies formats. It deliberately does not measure
    // the worker's wall-clock processing budget or establish hosted capacity.
    for (const videoPreset of Object.keys(VIDEO_PROFILES) as (keyof typeof VIDEO_PROFILES)[]) for (const audioBitrateKbps of [160,320] as const) {
        const settings = {videoPreset,audioBitrateKbps};
        const profile = VIDEO_PROFILES[videoPreset];
        const args = programEncoderArguments(settings);
        const noise = 'anoisesrc=color=white:sample_rate=48000:amplitude=0.5:seed=42[a];anoisesrc=color=white:sample_rate=48000:amplitude=0.5:seed=43[b];[a][b]amerge=inputs=2';
        // Replace only raw input transport with deterministic lavfi sources. All
        // production mapping, codec, bitrate, GOP and mux options remain unchanged.
        const program = execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc2=size=${profile.width}x${profile.height}:rate=${profile.frameRate}`,'-f','lavfi','-i',noise,'-t','6.2',...args.slice(args.indexOf('-map'))],{timeout:60000,maxBuffer:16*1024*1024});
        for (const destination of ['vrcdn','twitch'] as const) {
            const profile = resolveDestinationProfile({settings,destination});
            const path = `${directory}/${videoPreset}-${audioBitrateKbps}-${destination}.flv`;
            const destinationArgs = outputArguments(destination,{key:'synthetic',url:'rtmp://example.test/live'},profile);
            // Replace only publication transport with a local FLV file. All codec flags are production arguments.
            const local = destinationArgs.slice(0,destinationArgs.indexOf('-rw_timeout'));
            local[local.indexOf('-progress')+1] = 'pipe:2';
            execFileSync('ffmpeg',[...local,'-y','-f','flv',path],{input:program,timeout:30000,stdio:['pipe','ignore','pipe']});
            const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_packets','-of','json',path],{encoding:'utf8',maxBuffer:16*1024*1024}));
            const video = probe.streams.find((s:{codec_type:string})=>s.codec_type==='video');
            const audio = probe.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
            assert.equal(video.codec_name,'h264'); assert.equal(video.pix_fmt,'yuv420p');
            assert.deepEqual([video.width,video.height],[profile.width,profile.height]);
            const [n,d] = video.avg_frame_rate.split('/').map(Number); assert.equal(n/d,profile.frameRate);
            assert.equal(audio.codec_name,'aac'); assert.equal(audio.channels,2); assert.equal(Number(audio.sample_rate),48000);
            const audioPackets = probe.packets.filter((p:{stream_index:number,pts_time:string})=>p.stream_index===audio.index && Number(p.pts_time)>=0.5 && Number(p.pts_time)<4);
            const bitrate = audioPackets.reduce((n:number,p:{size:string})=>n+Number(p.size),0)*8/3.5/1000;
            assert(Math.abs(bitrate-profile.audioBitrateKbps)/profile.audioBitrateKbps<0.18,`${videoPreset}/${audioBitrateKbps}/${destination}: ${bitrate}kbps`);
            const keys = probe.packets.filter((p:{stream_index:number,flags:string})=>p.stream_index===video.index && p.flags.includes('K')).map((p:{pts_time:string})=>Number(p.pts_time));
            assert(keys.length>=3,`Need actual GOP intervals: ${keys}`);
            const gaps = keys.slice(1).map((t:number,i:number)=>t-keys[i]);
            for (const gap of gaps) assert(Math.abs(gap-profile.keyframeIntervalSeconds)<1/profile.frameRate+0.001,`${destination} GOP ${gap}`);
            const decoded = spawnSync('ffmpeg',['-hide_banner','-i',path,'-ss','0.5','-t','3','-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8',stdio:['ignore','ignore','pipe']});
            assert.equal(decoded.status,0);
            const volume = decoded.stderr.match(/mean_volume: (-?[\d.]+) dB/);
            assert(volume && Number(volume[1]) > -40, 'Fixture must produce audible decoded audio');
            // Decode the complete file too, proving both actual encoded streams are readable.
            execFileSync('ffmpeg',['-v','error','-i',path,'-f','null','-'],{timeout:30000,stdio:'ignore'});
            results.push({videoPreset,audioBitrateKbps,destination,width:video.width,height:video.height,fps:n/d,audioKbps:bitrate,gops:gaps});
            await rm(path);
        }
        console.log(`verified formats ${videoPreset}/${audioBitrateKbps}`);
        await writeFile(`${directory}/result.json`,JSON.stringify(results,null,2));
    }
    console.log(`Format evidence: ${directory}/result.json`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

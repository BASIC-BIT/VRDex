// Source-only TS/H264/AAC framing fixtures. Payloads are opaque, not media.
const bits=(n,width)=>BigInt(n).toString(2).padStart(width,'0');
const ue=n=>{const s=BigInt(n+1).toString(2);return '0'.repeat(s.length-1)+s;};
function nal(header,text) {
 const padded=(text+'1').padEnd(Math.ceil((text.length+1)/8)*8,'0'),out=[header];let zeros=0;
 for(let i=0;i<padded.length;i+=8){const b=parseInt(padded.slice(i,i+8),2);if(zeros===2&&b<=3){out.push(3);zeros=0;}out.push(b);zeros=b===0?zeros+1:0;}return Buffer.from(out);
}
function sei(type,payload) {return nal(6,bits(type,8)+bits(payload.length,8)+[...payload].map(b=>bits(b,8)).join(''));}
function section(hex) {
 const bytes=Buffer.from(hex,'hex');let crc=0xffffffff;
 for(const b of bytes){crc^=b<<24;for(let i=0;i<8;i++)crc=(crc<<1)^((crc&0x80000000)?0x04c11db7:0);}
 const tail=Buffer.alloc(4);tail.writeUInt32BE(crc>>>0);return Buffer.concat([bytes,tail]);
}
const tables=[section('00b00d0001c100000001e100'),section('02b0170001c10000e101f0001be101f0000fe102f000'),section('42f0230001c100000001ff0001fc80124810010646466d7065670753657276696365')];
function table(pid,body){const b=Buffer.alloc(188,255);b.set([0x47,0x40|(pid>>8),pid&255,0x10,0]);body.copy(b,5);return b;}
function pts(n){n=BigInt(n);return Buffer.from([0x21|Number(n>>30n&7n)<<1,Number(n>>22n&255n),Number(n>>15n&127n)<<1|1,Number(n>>7n&255n),Number(n&127n)<<1|1]);}
function pes(body,pid,timestamp) {
 const h=Buffer.from([0,0,1,pid===257?0xe0:0xc0,0,0,0x80,0x80,5]);if(pid===258)h.writeUInt16BE(body.length+8,4);return Buffer.concat([h,pts(timestamp),body]);
}
function packetize(body,pid,state) {
 const result=[];let offset=0;
 while(offset<body.length){const n=Math.min(184,body.length-offset),b=Buffer.alloc(188,255);b.set([0x47,(pid>>8)|(offset===0?0x40:0),pid&255,(n<184?0x30:0x10)|(state[pid]++&15)]);if(n<184){b[4]=183-n;if(b[4])b[5]=0;}body.copy(b,188-n,offset,offset+n);offset+=n;result.push(b);}return result;
}
function adts(payload){const n=payload.length+7;return Buffer.concat([Buffer.from([255,241,0x4c,0x80|(n>>11),n>>3&255,(n&7)<<5|31,252]),payload]);}
export function fakeProgramTransport({frames=2,audioUnits=5,audioPerPes=2,allKeyframes=false,keyInterval=Infinity}={}) {
 // High 854x480, POC2, flat PPS, 30fps VUI and single-CPB HRD.
 let s=bits(100,8)+bits(0,8)+bits(31,8)+ue(0)+ue(1)+ue(0)+ue(0)+'00'+ue(0)+ue(2)+ue(1)+'0'+ue(53)+ue(29)+'111'+ue(0)+ue(5)+ue(0)+ue(0);
 s+='1'+'0000'+'1'+bits(1,32)+bits(60,32)+'1'+'1'+ue(0)+bits(0,8)+ue(99)+ue(199)+'1'+bits(23,5)+bits(23,5)+bits(23,5)+bits(0,5)+'000'+'11'+ue(0)+ue(0)+ue(10)+ue(10)+ue(0)+ue(1);
 const sps=nal(0x67,s),pps=nal(0x68,ue(0)+ue(0)+'00'+ue(0)+ue(0)+ue(0)+'0'+'00'+ue(0)+ue(0)+ue(0)+'100');
 const buffer=sei(0,Buffer.from([0x80,0,0,0,0,0,0x40])),timing=sei(1,Buffer.alloc(6)),video=[],audio=Array.from({length:audioUnits},(_,i)=>adts(Buffer.from([0x20,i+1,0x80])));
 for(let i=0;i<frames;i++) {
  const predictive=i&&!allKeyframes&&i%keyInterval!==0,epoch=allKeyframes?i:Number.isFinite(keyInterval)?Math.floor(i/keyInterval):0,frameNum=Number.isFinite(keyInterval)?i%keyInterval:i;
  let text=ue(0)+ue(predictive?5:7)+ue(0)+bits(predictive?frameNum%16:0,4)+(predictive?'':ue(epoch%2));if(predictive)text+='00';text+=predictive?'0':'00';text+=ue(0)+ue(1)+'10110101';
  const bodies=[...(predictive?[]:[sps,pps,buffer]),timing,nal(predictive?0x41:0x65,text)];
  video.push(Buffer.concat([Buffer.from('0000000109f0','hex'),...bodies.flatMap((b,j)=>[Buffer.from(j===0||[7,8].includes(b[0]&31)?'00000001':'000001','hex'),b])]));
 }
 const state={257:0,258:0},chunks=[table(17,tables[2]),table(0,tables[0]),table(256,tables[1])];
 for(let i=0;i<Math.max(frames,Math.ceil(audioUnits/audioPerPes));i++) {
  if(i<frames)chunks.push(...packetize(pes(video[i],257,1920+3000*i),257,state));
  if(i*audioPerPes<audioUnits)chunks.push(...packetize(pes(Buffer.concat(audio.slice(i*audioPerPes,(i+1)*audioPerPes)),258,i*audioPerPes*1920),258,state));
 }
 return {bytes:Buffer.concat(chunks),video,audio};
}

/** Original-shaped VERBOSE/progress bytes for source-only orchestration. */
export function fakeProgramNativeLogs(inventory,{frames=2,samples=3200}={}) {
 const units=Math.ceil(samples/1024)+1,decoded=units*1024,videoBytes=frames*inventory.video.width*inventory.video.height*3/2;
 const file=(direction,index,streams)=>{
  const input=direction==='Input',verb=input?'read':'muxed';let packets=0,bytes=0;
  const rows=streams.map(([type,p,b,f,s],stream)=>{packets+=p;bytes+=b;return `[verbose]   ${direction} stream #${index}:${stream} (${type}): ${input?`${p} packets read (${b} bytes); ${f} frames decoded${s===null?'':` (${s} samples)`}`:`${f} frames encoded${s===null?'':` (${s} samples)`}; ${p} packets muxed (${b} bytes)`}; \n`;}).join('');
  return `[verbose] ${direction} file #${index} (pipe):\n${rows}[verbose]   Total: ${packets} packets (${bytes} bytes) ${input?'demuxed':verb}\n`;
 };
 const prefix='[verbose] No more output streams to write to, finishing.\n';
 const encoder=prefix+file('Input',0,[['video',frames,videoBytes,frames,null]])+file('Input',1,[['audio',Math.ceil(samples/1024),samples*4,Math.ceil(samples/1024),samples]])+file('Output',0,[['video',frames,inventory.video.muxPayloadBytes,frames,null],['audio',units,inventory.audio.muxPayloadBytes,Math.ceil(samples/1024),samples]]);
 const decoder=prefix+file('Input',0,[['video',frames,inventory.video.nativeInputBytes,frames,null],['audio',units,inventory.audio.nativeInputBytes,units,decoded]])+file('Output',0,[['video',frames,6*frames,frames,null]])+file('Output',1,[['audio',units,2*decoded,units,decoded]]);
 const progress=Buffer.from(`frame=${frames}\nfps=30.00\nstream_0_0_q=-1.0\nbitrate= 123.4kbits/s\ntotal_size=1234\nout_time_us=400000\nout_time_ms=400000\nout_time=00:00:00.400000\ndup_frames=0\ndrop_frames=0\nspeed=1.23x\nprogress=end\n`);
 return {encoder:Buffer.from(encoder),decoder:Buffer.from(decoder),progress};
}

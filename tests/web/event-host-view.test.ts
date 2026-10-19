import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createSourceStatusReader, reportedSourceState } from '../../apps/web/src/lib/event-source-observations';
it('deduplicates sources, caps concurrent probes and preserves observation age', async () => {
 let active=0, maximum=0, calls=0;
 const read=createSourceStatusReader(async () => { calls++; active++; maximum=Math.max(active,maximum); await new Promise(resolve=>setTimeout(resolve,5)); active--; return {state:'live',observedAt:100}; },()=>200);
 const sources=Array.from({length:9},(_,i)=>({key:`vrcdn:${i}`,url:`vrcdn:${i}`}));
 const first=await read([...sources,...sources]); await read(sources);
 assert.equal(calls,9); assert.equal(maximum,4); assert.equal(first['vrcdn:0'].observedAt,100);
 assert.equal(reportedSourceState(first['vrcdn:0'],60101),'unavailable');
});
it('isolates failed provider checks',async()=>{
 const read=createSourceStatusReader(async()=>{throw Error('timeout')},()=>123);
 assert.deepEqual(await read([{key:'twitch:one',url:'https://twitch.tv/one'}]),{'twitch:one':{state:'unavailable',observedAt:123}});
});

import { execFileSync } from 'node:child_process';
import path from 'node:path';
it('renders authored repeated/freeform/missing-link rows, selected source and all choices without players',()=>{
 execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`
 import assert from 'node:assert/strict';
 import {createElement} from 'react';
 import {renderToStaticMarkup} from 'react-dom/server';
 import {EventHostContent} from './src/app/_components/event-host-view.tsx';
 const person={slug:'one',displayName:'Aurora',outboundLinks:[{url:'vrcdn:aurora'}, {url:'vrcdn:alternate'}, {url:'https://twitch.tv/aurora'}]};
 const lineup=[{key:'first',displayLabel:'Aurora',position:0,performer:person},{key:'second',displayLabel:'Aurora',position:1,performer:person},{key:'guest',displayLabel:'Freeform guest',position:2}];
 const event={slug:'show',communitySlug:'club',title:'Show',lineup,slots:[{playbackKey:'first',stream:{streamId:'aurora'}}]};
 const html=renderToStaticMarkup(createElement(EventHostContent,{event}));
 assert.equal(html.split('>Aurora</h2>').length-1,2);
 assert.match(html,/Freeform guest/);assert.match(html,/No links/);
 assert.equal(html.split('Selected source').length-1,1);
 assert.match(html,/alternate/);assert.match(html,/Twitch/);
 assert.doesNotMatch(html,/<video|<audio|<iframe|Broadcast.selected|Scheduled now/);
 const revoked=renderToStaticMarkup(createElement(EventHostContent,{event:{...event,lineup:lineup.map(row=>({...row,performer:row.performer?{...person,outboundLinks:[]}:undefined}))}}));
 assert.doesNotMatch(revoked,/Copy PC|Copy Quest|Selected source/);
 `],{cwd:path.resolve('apps/web'),stdio:'pipe'});
});
it('keeps simultaneous live sources separate and refreshes expired cache entries',async()=>{
 let now=100;let calls=0;
 const read=createSourceStatusReader(async()=>({state:'live',observedAt:++calls}),()=>now);
 const sources=[{key:'vrcdn:a',url:'vrcdn:a'},{key:'twitch:a',url:'https://twitch.tv/a'}];
 const states=await read(sources);
 assert.equal(states['vrcdn:a'].state,'live');assert.equal(states['twitch:a'].state,'live');
 now=30_101;await read(sources);assert.equal(calls,4);
});
it('deduplicates pending probes beyond the cache window',async()=>{
 let now=0;let calls=0;let release:()=>void=()=>{};
 const held=new Promise<void>(resolve=>{release=resolve});
 const read=createSourceStatusReader(async()=>{calls++;await held;return {state:'live',observedAt:now}},()=>now);
 const source=[{key:'vrcdn:held',url:'vrcdn:held'}];
 const first=read(source);now=31_000;const second=read(source);
 release();await Promise.all([first,second]);assert.equal(calls,1);
});

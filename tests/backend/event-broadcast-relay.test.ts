import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createSourceRelay } from '../../workers/restream/source-relay.mjs';
const source = (id: number, revision = 0) => ({ id: `source-${id}`, type: 'vrcdn_link', publicUrl: `https://stream.vrcdn.live/live/dj${id}_${revision}.live.ts` });
it('R5F3 more than 64 historical sources retain only current and prepared routes, then rotate', async () => {
  const relay = await createSourceRelay();
  try {
    let previous: string | undefined;
    for (let i = 0; i < 70; i++) {
      relay.retainSources?.([source(i), source(i + 1)]);
      const current = relay.resolveSource(source(i));
      const warm = relay.resolveSource(source(i + 1));
      assert.equal(relay.resolveSource(source(i)), current);
      if (previous) assert.equal((await fetch(previous)).status, 404);
      previous = current;
      if (i === 69) {
        relay.retainSources?.([source(i, 1), source(i + 1)]);
        assert.notEqual(relay.resolveSource(source(i, 1)), current);
        assert.equal(relay.resolveSource(source(i + 1)), warm);
        assert.equal((await fetch(current)).status, 404);
        relay.retainSources?.([source(i, 1)]);
        assert.equal((await fetch(warm)).status, 404);
      }
    }
  } finally { relay.stop(); }
});
it('R5F3 historical routes cannot exhaust the live route bound', async () => {
  const relay = await createSourceRelay();
  try {
    for (let i = 0; i < 70; i++) {
      relay.retainSources?.([source(i)]);
      assert.match(relay.resolveSource(source(i)), /^http:\/\/127\.0\.0\.1:/);
    }
  } finally { relay.stop(); }
});

import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
it('pinned lookup honors all=true while exposing only the first validated public IPv4', async () => {
  const provider = createServer((_req, res) => res.end('synthetic media'));
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const answers = [{ address: '93.184.216.34', family: 4 }, { address: '8.8.8.8', family: 4 }];
  let resolutions = 0;
  const results: unknown[][] = [];
  const relay = await createSourceRelay({
    resolveAddresses: async () => { resolutions++; return answers; },
    requestSource: (_url: URL, options: { lookup: (host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void }, callback: (response: IncomingMessage) => void) => {
      for (const lookupOptions of [{ all: true }, { all: false }, {}]) {
        options.lookup('synthetic.invalid', lookupOptions, (...args) => results.push(args));
      }
      const address = provider.address();
      assert(address && typeof address !== 'string');
      return httpRequest(`http://127.0.0.1:${address.port}`, callback);
    },
  });
  try {
    const response = await fetch(relay.resolveSource(source(1)));
    assert.equal(await response.text(), 'synthetic media');
    assert.deepEqual(results, [
      [null, [{ address: answers[0].address, family: 4 }]],
      [null, answers[0].address, 4],
      [null, answers[0].address, 4],
    ]);
    assert.equal(resolutions, 1, 'lookup callbacks reuse the validated selection without another DNS lookup');
  } finally { relay.stop(); provider.closeAllConnections(); provider.close(); }
});
it('R5F3 retained streams survive reconciliation; retired routes close sockets, stop closes all', async () => {
  const provider = createServer((_req, res) => { res.writeHead(200); res.write('media'); });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  let connections = 0;
  const relay = await createSourceRelay({
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    requestSource: (_url: URL, options: any, callback: any) => {
      options.lookup('', {}, (_error: unknown, address: string) => assert.equal(address, '93.184.216.34'));
      connections++;
      return httpRequest(`http://127.0.0.1:${(provider.address() as any).port}`, callback);
    },
  });
  const open = async (url: string) => { const req = httpRequest(url); req.end(); const [response] = await once(req, 'response'); response.on('error', () => {}); response.resume(); return response; };
  try {
    const a = relay.resolveSource(source(1)), b = relay.resolveSource(source(2));
    const active = await open(a), warm = await open(b);
    relay.retainSources([source(1), source(2), { ...source(3), publicUrl: 'http://127.0.0.1/private' }]);
    assert.throws(() => relay.resolveSource({ ...source(3), publicUrl: 'http://127.0.0.1/private' }));
    assert.equal(active.destroyed, false); assert.equal(warm.destroyed, false);
    assert.equal(relay.resolveSource(source(1)), a); assert.equal(connections, 2);
    const warmClosed = new Promise(resolve => warm.once('close', resolve));
    relay.retainSources([source(1)]); await warmClosed;
    assert.equal(active.destroyed, false); assert.equal((await fetch(b)).status, 404);
    const activeClosed = new Promise(resolve => active.once('close', resolve));
    relay.stop(); await activeClosed;
    await assert.rejects(fetch(a));
  } finally { relay.stop(); provider.closeAllConnections(); provider.close(); }
});
it('R5F3 relay refuses private DNS results and never follows redirects', async () => {
  let requests = 0;
  const provider = createServer((_req, res) => { requests++; res.writeHead(302, { location: 'http://127.0.0.1/private' }).end(); });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const relay = await createSourceRelay({ resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }], requestSource: (_url: URL, _options: any, callback: any) => httpRequest(`http://127.0.0.1:${(provider.address() as any).port}`, callback) });
  const privateRelay = await createSourceRelay({ resolveAddresses: async () => [{ address: '127.0.0.1', family: 4 }], requestSource: () => { throw Error('must not request private address'); } });
  try {
    assert.equal((await fetch(privateRelay.resolveSource(source(1)))).status, 502);
    assert.equal((await fetch(relay.resolveSource(source(1)))).status, 502); assert.equal(requests, 1);
  } finally { relay.stop(); privateRelay.stop(); provider.closeAllConnections(); provider.close(); }
});
it('R5F3 the live mapping cap remains 64 and identical URLs retain distinct source identities', async () => {
  const relay = await createSourceRelay();
  try {
    const first = relay.resolveSource(source(0));
    assert.notEqual(relay.resolveSource({ ...source(0), id: 'different' }), first);
    for (let i = 1; i < 63; i++) relay.resolveSource(source(i));
    assert.throws(() => relay.resolveSource(source(63)), /bound/);
    relay.retainSources([source(0)]); assert.equal(relay.resolveSource(source(0)), first);
    assert.doesNotThrow(() => relay.resolveSource(source(63)));
  } finally { relay.stop(); }
});
it('handle disposal owns pending DNS and rejects reconnects until physical lookup completion',async()=>{
 let resolveDns:any,lookups=0,requests=0;
 const dns=new Promise(resolve=>{resolveDns=resolve;});
 const relay=await createSourceRelay({resolveAddresses:()=>{lookups++;return dns;},requestSource:()=>{requests++;throw Error('obsolete request');}});
 const handle=relay.createInput({source:{...source(1),revision:1}});const {url}=await handle.transportReady;
 const req=httpRequest(url);req.on('error',()=>{});req.end();
 for(let i=0;i<100&&lookups===0;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(lookups,1);assert.equal((await fetch(url)).status,409);assert.equal(lookups,1);
 req.destroy();await new Promise(resolve=>setTimeout(resolve,10));
 let closed=false;const cleanup=handle.dispose().then(()=>{closed=true;});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,false,'already-closing connection still owns DNS');
 resolveDns([{address:'93.184.216.34',family:4}]);await cleanup;assert.equal(requests,0);assert.equal((await fetch(url)).status,404);relay.stop();
});

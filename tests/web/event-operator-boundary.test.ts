import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual route/component with only framework and network boundaries
// substituted. No copied guard or request-building implementation.
const webRequire = createRequire(path.resolve('apps/web/package.json'));
function load(relative: string, dependencies: Record<string, unknown>) {
  const filename = path.resolve('apps/web/src', relative);
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports: Record<string, any> = {};
  vm.runInNewContext(outputText, { exports, require: (name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? path.resolve('apps/web/src', name.slice(2)) : path.resolve(path.dirname(filename),name);
      for (const extension of ['', '.ts', '.tsx']) { try { readFileSync(target + extension); } catch { continue; }
        if ((target + extension).endsWith('.mjs')) return webRequire(target + extension);
        return load(path.relative(path.resolve('apps/web/src'),target+extension),dependencies);
      }
    }
    return webRequire(name);
  }, Date, setInterval, clearInterval, performance });
  return exports;
}
const api = { eventMediaSources:{create:'create',replace:'replace',remove:'remove'},eventMediaSettings:{configure:'settings'}, events: { getEventMediaControlStatus: 'status', scheduleEventMediaWorker: 'start', queueEventMediaCommand: 'queue', stopEventMediaWorker: 'stop', configureEventBroadcastPolicy: 'policy', configureTwitchOutput: 'twitch', cancelEventMediaOperation:'cancel' } };
function routeFixture({ token = 'jwt', authorized = true, eventPath = '/club/events/show', canControl = false } = {}) {
  const calls: string[] = [];
  const status = { eventPath, canControl };
  const route = load('app/[slug]/events/[eventSlug]/operate/page.tsx', {
    'convex/nextjs': { fetchQuery: async (ref: unknown, args: any, options: any) => { calls.push('authorize'); assert.equal(ref, 'status'); assert.equal(args.currentSlug, 'show'); assert.equal(options.token, token); if (!authorized) throw Error('denied'); return status; } },
    'next/navigation': { redirect: (url: string) => { throw Error(`redirect:${url}`); }, notFound: () => { throw Error('404'); } },
    '@convex-generated-api': { api },
    '@/lib/server/auth': { convexAuthToken: async () => token, signInPath: (path: string) => `/sign-in?return=${path}` },
    '@/convex/server': { fetchPublicEventBySlug: async () => { calls.push('public'); return { kind: 'live', event: undefined }; } },
    '../../../../_components/event-operator-view': { EventOperatorView: () => null },
  }).default;
  return { calls, status, run: () => route({ params: Promise.resolve({ slug: 'club', eventSlug: 'show' }) }) };
}
it('F3 authorized read-only staff reaches the actual operator route after token forwarding', async () => {
  const f = routeFixture();
  const element = await f.run();
  assert.equal(element.props.initialStatus, f.status);
  assert.deepEqual(f.calls, ['authorize', 'public']);
});
it('F3 actual route denies anonymous, nonstaff and mismatched paths before fetching/rendering payload', async () => {
  for (const input of [{ token: '' }, { authorized: false }, { eventPath: '/other/events/show' }]) {
    const f = routeFixture(input);
    await assert.rejects(f.run(), input.token === '' ? /redirect:.*sign-in/ : /404/);
    assert.equal(f.calls.includes('public'), false);
    if (input.token === '') assert.deepEqual(f.calls, []);
  }
});
function operatorFixture() {
  const requests: Array<{ ref: string; args: any }> = [];
  const React = webRequire('react');
  const status = { eventTitle: 'Show', eventPath: '/club/events/show', canControl: false, outputConfigurationLocked: false, serverNow: Date.now(), program: null, sessions: [], sources: [], outputs: [], commands: [], twitchAccounts: [] };
  const component = load('app/_components/event-operator-view.tsx', {
    'next/link': { default: (props: any) => React.createElement('a', props) },
    'convex/react': { useQuery: () => status, useMutation: (ref: string) => async (args: any) => { requests.push({ ref, args }); } },
    '@convex-generated-api': { api },
    '@/lib/event-broadcast-observation': { eventBroadcastObservationFresh: () => false },
    '@/components/ui/button': { Button: ({ variant, size, ...props }: any) => React.createElement('button', props) },
    '@/components/ui/page-shell': { PageContainer: ({ max, ...props }: any) => React.createElement('div', props), PageShell: (props: any) => React.createElement('div', props) },
    './viewer-local-event-times': { ViewerLocalEventDateTime: () => null },
    './event-host-view': { EventHostView: () => null },
  });
  return { component, requests, status, React };
}
it('F2 actual operator view sends an explicit immediate request without client-clock schedule fields', async () => {
  const f = operatorFixture();
  const tree = f.component.EventOperatorView({ currentSlug: 'show', initialStatus: f.status });
  await tree.props.children.props.onStart('primary');
  assert.equal(f.requests[0].ref, 'start');
  assert.equal(JSON.stringify(f.requests[0].args), JSON.stringify({ currentSlug: 'show', outputKey: 'primary', startImmediately: true }));
});
it('F3 rendered read-only controls disable every broadcast mutation', () => {
  const f = operatorFixture();
  const { renderToStaticMarkup } = webRequire('react-dom/server');
  const html: string = renderToStaticMarkup(f.React.createElement(f.component.EventOperatorControls, { status: f.status }));
  for (const label of ['Next', 'Hold current', 'Cut to slate', 'Return to auto', 'Stop', 'Start', 'Save policy']) {
    assert.match(html, new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
  }
  assert.match(html, /<fieldset[^>]*disabled=""/);
});

it('R2F1 terminal reserved output configuration stays disabled independently of the visible session', () => {
  const f = operatorFixture();
  f.status.canControl = true;
  f.status.outputConfigurationLocked = true;
  const { renderToStaticMarkup } = webRequire('react-dom/server');
  const html: string = renderToStaticMarkup(f.React.createElement(f.component.EventOperatorControls, { status: f.status }));
  assert.match(html, /<fieldset[^>]*disabled=""/);
});

it('an unresolved replacement subscription cannot restore initial permissions or private sources',()=>{
 const React=webRequire('react');
 const component=load('app/_components/event-operator-view.tsx',{
  'convex/react':{useQuery:()=>undefined,useMutation:()=>async()=>{}},'@convex-generated-api':{api},
  'next/link':{default:()=>null},'./event-host-view':{EventHostView:()=>null},
  '@/components/ui/button':{Button:()=>null},'@/components/ui/page-shell':{PageContainer:()=>null,PageShell:()=>null},
  './viewer-local-event-times':{ViewerLocalEventDateTime:()=>null},
 });
 const tree=component.EventOperatorView({currentSlug:'new-event',initialStatus:{canControl:true,sources:[{label:'Old private source'}]}});
 assert.equal(tree,null);assert(React);
});

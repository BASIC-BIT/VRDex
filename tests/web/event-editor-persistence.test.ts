import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredSnapshot, hasUnsavedEventChanges, mergeSavedEventFields } from '../../apps/web/src/lib/event-editor-persistence';
test('authored snapshots sort keys, preserve array order and null versus omission', () => {
  assert.equal(authoredSnapshot({ b: 2, a: { z: 0, y: 1 } }), authoredSnapshot({ a: { y: 1, z: 0 }, b: 2 }));
  assert.notEqual(authoredSnapshot({ a: null }), authoredSnapshot({}));
  assert.notEqual(authoredSnapshot([1, 2]), authoredSnapshot([2, 1]));
});
test('only command fields and meaningful pending buffers affect dirty state', () => {
  const persisted = authoredSnapshot({ title: 'Night', lineup: [] });
  assert.equal(hasUnsavedEventChanges({ current: persisted, persisted, pendingInput: false }), false);
  for (const buffer of ['invalid clock', 'duration', 'name override']) {
    assert.equal(hasUnsavedEventChanges({ current: persisted, persisted, pendingInput: Boolean(buffer) }), true);
  }
});
test('save completion preserves newer fields, keyed row overrides and deletions', () => {
  const submitted = { title: 'Before', lineup: [{ clientKey: 'a', label: 'Old' }, { clientKey: 'b', label: 'Gone' }] };
  const current = { title: 'New', lineup: [{ clientKey: 'a', label: 'Override' }] };
  const saved = { title: 'Before', lineup: [{ clientKey: 'a', label: 'Source' }, { clientKey: 'b', label: 'Gone' }] };
  assert.deepEqual(mergeSavedEventFields(current, submitted, saved), current);
  assert.equal(hasUnsavedEventChanges({ current: authoredSnapshot(current), persisted: authoredSnapshot(saved), pendingInput: false }), true);
});
test('unchanged source fields merge while newer fields remain local', () => {
  assert.deepEqual(mergeSavedEventFields({ title: 'New', poster: null }, { title: 'Old', poster: null }, { title: 'Old', poster: 'saved-source' }), { title: 'New', poster: 'saved-source' });
});

test('newer source edits do not regain stale extraction suggestions', () => {
  const submitted = { sourceText: 'Old source', tentative: null, questions: null, evidence: null };
  const current = { ...submitted, sourceText: 'New source' };
  const saved = { ...submitted, tentative: { title: 'Old suggestion' }, questions: ['Old question'], evidence: [] };
  assert.deepEqual(mergeSavedEventFields<object>(current, submitted, saved), current);
});


test('broadcast choice edits preserve legacy playback and survive dirty state and in-flight saves',()=>{
 const submitted={lineup:[{clientKey:'a',selectedStreamId:'legacy',broadcastInput:{kind:'twitch',channel:'first'}}]};
 const current={lineup:[{clientKey:'a',selectedStreamId:'legacy',broadcastInput:{kind:'twitch',channel:'next'}}]};
 const saved=JSON.parse(JSON.stringify(submitted));
 assert.deepEqual(mergeSavedEventFields(current,submitted,saved),current);
 assert.equal(hasUnsavedEventChanges({current:authoredSnapshot(current),persisted:authoredSnapshot(saved),pendingInput:false}),true);
 assert.notEqual(authoredSnapshot({broadcastInput:null}),authoredSnapshot({broadcastInput:undefined}));
 assert.equal(JSON.parse(authoredSnapshot(current)).lineup[0].selectedStreamId,'legacy');
});

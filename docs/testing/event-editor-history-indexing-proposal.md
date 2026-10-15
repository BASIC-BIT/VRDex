# Event editor history indexing decision

Approved and applied. BASIC answered the exact two-file approval question with
"approved, and you have standing approval for similar stuff in the future".
Public History API indexing now stays installed for the browser page lifetime.
It lets the unsaved-edit guard identify Back, Forward and multi-step destinations
when the browser does not expose the Navigation API. Product copy is unchanged.

## Scope and implementation

The [approved patch](./event-editor-history-indexing-proposal.patch) records the
two-file change. It was applied with hunk context adjusted to retain the later
`browserEscape` handling. The existing `apps/web/src/instrumentation-client.ts`
initializes the module before hydration.

The bootstrap adds one namespaced numeric position to the current entry and
subsequent public `pushState` and `replaceState` calls while preserving caller
state fields. Its capture listener tracks position. Initialization is idempotent.
It does not inspect private Next.js state or rewrite earlier entries.

The wrappers and inert capture listener remain installed after the editor unmounts.
Every editor delegate, dirty closure, link listener and `beforeunload` handler
still unregisters. Normal pages have no editor delegate and no prompt. Entries
with unknown positions pass through without a guessed traversal distance.

Standing approval covers similar reversible navigation and edit-protection
implementation details within already-approved work. It does not authorize merges,
production deployments, destructive operations or unrelated security or billing
changes. The earlier automatic-review rejections are superseded by this direct
human authorization.

## Risk and verification

A mistake in these app-wide wrappers could regress navigation outside the editor.
Real Chromium coverage removes the Navigation API before bootstrap and exercises
normal-page entry, dirty Back and Forward, repeated cancellation, multi-step
traversal, retained values and caller/framework state, acceptance once, and clean
navigation after editor unmount. See the
[checkpoint](./event-editor-identity-checkpoint.md) for executed results and limits.

Unknown entries can trigger framework document navigation and native unload
confirmation. The guard does not guess a direction or replay them. Browser
noncancelable traversals and native unload restrictions remain compatibility
limits. The guard permits the browser's escape behavior.

The public [Next.js instrumentation-client hook](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client)
runs before hydration. The [HTML navigation standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html)
describes traversal and cancellation behavior.

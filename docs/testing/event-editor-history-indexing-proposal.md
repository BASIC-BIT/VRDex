# Event editor history indexing proposal

Approval requested: keep two small public History API wrappers installed for the browser page lifetime. This lets the unsaved-edit guard identify Back, Forward and multi-step destinations when the browser does not expose the Navigation API. No product copy changes are proposed.

The current editor-only wrappers cannot identify entries created before the editor opened. Guessing that an unknown entry means one step Back can restore the wrong page or trap navigation. The safe interim behavior allows those unknown destinations through, so fallback protection is incomplete.

## Exact change

[Review the unapplied patch](./event-editor-history-indexing-proposal.patch). It changes only `apps/web/src/lib/event-editor-history.ts` and `apps/web/src/app/events/use-event-editor-leave-guard.ts`. The existing `apps/web/src/instrumentation-client.ts` initializes the module before hydration.

The bootstrap adds one namespaced numeric position to the current entry and subsequent public `pushState` and `replaceState` calls while preserving caller state fields. Its existing capture listener tracks position. Initialization is idempotent. It does not inspect private Next.js state or rewrite earlier entries.

The wrappers and inert capture listener remain installed after the editor unmounts. Every editor delegate, dirty closure, link listener and `beforeunload` handler still unregisters. Normal pages have no editor delegate and no prompt. Entries with unknown positions remain an explicit limitation: the guard must allow them through rather than guess a traversal distance.

## Risk and verification

A mistake in these app-wide wrappers could regress history navigation outside the editor. Before accepting the implementation, run real Chromium tests with the Navigation API removed before bootstrap: normal-page entry, dirty Back and Forward, repeated cancellation, multi-step traversal, accept once, and clean navigation after editor unmount. Preserve existing framework history fields in those checks.

Browser noncancelable traversals and native unload restrictions remain compatibility limits. The guard must permit the browser's escape behavior.

The public [Next.js instrumentation-client hook](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client) runs before hydration. The [HTML navigation standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html) describes traversal and cancellation behavior.

Automatic approval review rejected applying persistent wrappers because the exact operation lacked direct user authorization. This file and patch make that operation reviewable; the patch has not been applied.

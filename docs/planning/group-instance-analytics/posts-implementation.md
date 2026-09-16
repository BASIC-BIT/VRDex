# Posts implementation

The club Posts screen now saves creator-owned drafts, previews their text, and queues modern group post publication, editing, or deletion. Draft operations require both `publish_posts` and the enabled Posts feature. Draft reads use creator-scoped cursor pagination. Revision checks reject stale writes; duplicate creation requests cannot change the original content.

Publishing freezes the saved revision and atomically enqueues one operation through the shared operation helper. Repeated queue requests return the same operation. Drafts cannot be edited or deleted after queueing: their link opens Scheduled actions, where the actual pending operation can be edited or cancelled. This avoids creating a second post while the first is still pending. The list displays the real operation state rather than labelling an enqueued post published.

The composer offers an explicit notification checkbox (off initially), public/group audience, immediate publication, a fixed local date/time, or an event-relative offset in minutes. Event options come from the authorized shared club event query. Post creation and edits require a final confirmation. Provider-post deletion has its own confirmation and stable request identity across retries. Existing image and role restrictions are preserved when opening a provider post for editing.

The screen reads provider posts through the worker-backed provider-read hook. Reads are paginated; editing and deletion controls require a fresh read. Execution-time permissions, enabled features, bot grants, schedule rebasing and cancellation remain enforced by the shared operation runtime, not this component.

## Evidence and remaining verification

- Backend tests exercise creator isolation, request idempotency, stale revision rejection, duplicate queue prevention, permission and feature revocation, and failed publication rollback.
- Desktop/mobile Storybook tests cover the complete Posts screen, draft save, queued publication, deletion cancellation, preview, explicit notification choice and event-relative confirmation.
- Screenshots: `.cache/artifacts/posts-desktop.png`, `posts-mobile.png`, `posts-workspace-desktop.png`, and `posts-workspace-mobile.png` within the implementation worktree. All four were visually reviewed.
- The fixture transport verifies local UI behavior. No provider post was published, edited or deleted, and hosted verification remains outstanding.

## Copy review before shipping

New authored sentences proposed by this slice include: “Draft saved.”, “Post queued.”, “Post deletion queued.”, “Posts are disabled.”, “Queue this post?”, “Queue changes to this post?”, “Group members will be notified.”, and “No group notification.” Error fallback wording: “Unable to save post.” and “Unable to update post.” These are local implementation copy, not a claim of BASIC's exact-copy approval.

# Event association implementation

Instance detail now offers a deliberate event association to the owner or staff with `manage_events`. The selected event and observed session must belong to the same club and current integration epoch. The confirmed association is shown afterward. Event selection is paginated and uses the shared club event picker query.

The shared event picker includes drafts for the owner and staff with `manage_events`. Staff whose permissions only cover other club operations receive a paginated published-event selection. Recap pages scan past unpublished event rollups before returning visible rows; a sort-position cursor preserves order when event rollups share a start time or the previous cursor row is deleted. Each query caps its consumed candidates at 1,000, and the dashboard continues automatically when a capped page has no visible result. Same-time index refinement can reread earlier rows, so the cap is not an absolute database-read bound.

The existing confirmed association and event-rollup model is reused. Association does not create a session, alter source observations, infer a closing time or claim named attendance. A session already confirmed for another event cannot be reassigned by submitting a different event. Both manual association and suggestion review require `manage_events`, including confirmation and rejection; `manage_integrations` alone is insufficient.

Q23 is implemented through this deliberate path: after an event-created instance is observed, staff can select its actual instance detail and associate the event. Successful operation results retain their event identifier and destination, but there is no automatic destination-to-session matching in this change. An unobserved instance cannot acquire invented analytics. Broader comparison reports remain candidate scope.

Pending time and world suggestions are reviewed on the club Analytics page by staff with `manage_events` and access to event recaps. The list is private, paginated, and scoped to the current group connection. A valid suggestion can be confirmed or rejected; a stale suggestion can only be rejected. Each confirm or reject mutation rechecks current recap visibility as well as `manage_events` before any association or rollup change. A saved suggestion ID grants no access after visibility is revoked; owners retain their category access. Manual association and confirmed-association lookup keep their separate `manage_events` contract. Review updates the list. Staff with instance history access can open the instance and return to the same Analytics context.

The legacy private dashboard follows the same manager-plus-recap gate for association records and unpublished event-selection context. Every returned association omits actor subjects and unused audit fields. Recap-only staff receive published, same-community event labels and rollups; canonical events are resolved by recap event ID so the latest-event and association limits cannot hide older valid recaps. Suggested and rejected associations do not generate recaps. The separate confirmed-association query on instance detail remains available to event managers regardless of recap visibility. Integration management alone grants no association access.

```mermaid
flowchart LR
  A[Club workspace link] --> B{Signed in?}
  D[Direct Analytics link] --> B
  B -- No --> C[Sign in] --> E[Club Analytics]
  B -- Yes --> E
  E -- Owner or event manager with recap access --> F[Event associations]
  F -- Instance history readable --> G[Inspect instance] --> F
  F --> H[Confirm or reject] --> F
  F --> E
```

Verification: telemetry backend tests cover denied anonymous and integration-only callers, authorized event staff, stale epochs, foreign events, conflicting confirmed associations and recap recomputation. Desktop/mobile Storybook interaction selects an event, associates it and displays the persisted fixture response. Screenshots in `.cache/artifacts/event-association-desktop.png` and `event-association-mobile.png` were visually inspected: no overlap or clipping, population remains prominent. Web typecheck passes. These checks do not prove a hosted authenticated journey or real provider observation.

New exact user-visible utility strings: `Event`, `Select event`, `Associate event`, `Load more events`, `Event: {title}`, `Event associated.`, `Association failed.`. BASIC approved the remaining exact copy on September 16, 2026; see the [release review](release-review.md#copy-status). Later substantive wording changes still need review.

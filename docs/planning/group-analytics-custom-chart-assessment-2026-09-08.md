# Group analytics: custom chart assessment

Status: Current recommendation, pending interactive comparison. Research only, 2026-09-08.

## Recommendation

Own the dashboard experience and its data semantics. Reuse chart geometry and interaction primitives. A small custom SVG chart remains appropriate for passive sparklines; expanding the current component into the entire inspectable analytics system is unlikely to be the best boundary.

If a higher-level chart package fights the desired design, visx is the strongest custom-build candidate to compare. It provides React visualization building blocks backed by D3, with independently usable packages. Its own documentation explicitly frames it as material for building a chart library, so choosing it means accepting chart-product ownership rather than expecting a finished dashboard. [visx repository](https://github.com/airbnb/visx)

## Current repository evidence

Inspected `apps/web/src/app/account/communities/[slug]/telemetry/community-telemetry-dashboard.tsx`:

- Lines 107-160 contain a small custom SVG line renderer. It calculates positions manually in a 720 by 220 viewBox and draws polylines with endpoint time labels.
- It filters non-observed/non-estimated points before segment construction, separates long gaps, and uses dashed estimated segments. Because excluded states disappear first, a short explicitly unknown interval can be bridged when the remaining timestamps are within `maxGapMs`. Preserve explicit missing intervals in the next data contract.
- Its domain is the first and last drawable observation rather than the requested time interval. Different widgets therefore need not align, and missing coverage at range boundaries can disappear from view.
- It has no point inspector, visible value axis, brushing, touch selection, keyboard point traversal, drill-down callback or table equivalent. The SVG has an image role and summary label; that does not make its individual values inspectable.
- Fewer than two drawable points produce an empty-state notice, so a single genuine observation cannot be inspected there.
- Lines 205-228 select raw data or hour/day rollups in the client. Rolled-up points omit coverage state and retain only positive-coverage buckets, which needs attention irrespective of renderer choice.
- The dashboard imports existing Button, Card, Field, Input, Select and Notice primitives. `apps/web/src/components/ui/field.tsx` supplies styled native controls and focus states; `table.tsx` is also available. Reuse this visual language for controls and accessible data views.

These are code observations, not a production or screenshot audit. No dependencies installed and no implementation changed.

## Own versus reuse boundary

| Concern | Ownership recommendation |
| --- | --- |
| Club permissions, named attendance restrictions | VRDex backend queries and exports enforce access before data reaches widgets. |
| Month, day and instance navigation | VRDex route/view state owns range, timezone, grain, filters, instance identity and back navigation. |
| Data aggregation and coverage | VRDex defines metric meaning, bucket boundaries, explicit unknown intervals and freshness. |
| Widget cards, selectors, calendar navigation | Existing UI primitives, adding shared primitives only where required. |
| Scales, ticks, SVG path geometry | Reuse a chart library, visx or focused D3 modules. |
| Range brush and pointer coordinate mapping | Prefer package primitives; prove pointer, touch and responsive behavior in the candidate prototype. |
| Keyboard and table navigation | VRDex provides explicit controls and equivalent inspectable rows, even if a library offers chart accessibility. |
| Simple decorative sparkline | Existing custom SVG can remain a small separate component. |

D3's line generator supports a `defined` predicate that ends a segment for missing points. This helps render explicit gaps, but VRDex must supply them and decide what counts as missing. [D3 line documentation](https://d3js.org/d3-shape/line)

D3 provides time scales with calendar ticks and inverse mappings, and brushing for selecting a region. Those building blocks do not decide whether selecting a day should fetch hourly data or navigate to an instance. [D3 time scales](https://d3js.org/d3-scale/time), [D3 brush](https://d3js.org/d3-brush)

## Interaction design to require of every candidate

1. The month uses explicit day buckets in the selected viewer timezone. Clicking a day changes the query to finer detail, preserving filters. Calendar-day boundaries must handle daylight-saving changes, rather than assuming every day is 24 hours.
2. Day detail shows linked population, instance activity and membership metrics where meaningful. Selecting an instance opens its detail. Membership events should not imply causal attribution to that instance.
3. A visible breadcrumb/back control restores the original month and filters. Browser back should behave consistently. Brush zoom and hierarchical navigation are distinct actions.
4. Hover previews a bucket; click or tap pins it for inspection. Controls and the data table provide keyboard access to the same selection and drill-down. Avoid requiring precise dragging on mobile.
5. Shared time domains keep gaps aligned across charts. Missing is distinct from zero, and sampled population is distinct from counted joins. Show coverage at the inspected bucket, not solely as a page-wide percentage.
6. Loading finer detail must not stretch aggregate points and pretend they are finer observations. Preserve the selection while loading and offer a useful empty state if detail is unavailable.

## Customizable home dashboard

Current recommendation: a curated widget catalog with show/hide, reorder, a small set of sizes and a preferred initial date range. Keep global filters coherent; offer an explicit override only when a widget needs one. A freeform query builder or arbitrary chart scripting is unnecessary for this request.

Use a small widget contract: stable widget key, metric identity, allowed sizes, supported grains, selected range/filter input, coverage metadata, and callbacks for selecting a bucket or opening detail. Store layout preferences rather than copied chart options or sensitive result data. Hidden widgets are a presentation preference; removing one never changes access permissions. Resolve permission changes on every relevant query and prevent saved layouts from restoring revoked data.

This contract should be just enough to support the chosen charts and a configurable home. Do not build a universal adapter for every candidate before choosing one. Whether layouts are personal, owner-provided defaults or shared presets remains an interview question.

## Maintenance tradeoff and selection test

Handwritten SVG plus focused D3 gives precise output and avoids accepting a broad chart API, but VRDex would own responsive axes, label collision, hit targets, focus behavior, tooltip placement, selection synchronization, brush coordination, reduced motion, touch conflicts and all their regressions. visx reduces geometry and component work while leaving much of that composition with us. No effort-hour estimate is justified by this research.

Compare the same one-month dataset and the same month-to-day-to-instance route in the leading higher-level candidate and a visx/custom candidate. Include an outage, a single observation, genuine zero values, estimated data, long labels, narrow widgets and a daylight-saving boundary. Judge whether values are easy to inspect, keyboard/touch work, gaps stay honest, resizing is stable and implementation remains understandable. Select custom only if it visibly improves this workflow enough to justify owning those behaviors.

# Group analytics: independent chart alternatives review

Research date: 2026-09-08. Candidate direction, not a dependency decision. Read alongside [the original comparison](./group-analytics-chart-library-research-2026-09-08.md). Official documentation and repository source only. No packages installed, implementation performed, production calls made, or runtime claims verified.

## Recommendation to challenge

Give **Recharts with selectively adapted shadcn chart components equal billing with ECharts**, and prototype Recharts first. The requested month-to-day-to-instance experience is chiefly application navigation and data querying. It does not inherently require a sophisticated pan/zoom engine. A cohesive React dashboard with inspectable details may be easier to deliver and maintain through React composition. This is an engineering judgment, not a measured result.

shadcn is particularly relevant: its current chart documentation uses Recharts v3 and supplies editable tooltip, legend and container components, CSS-variable colors and keyboard/screen-reader support through `accessibilityLayer`. We can adapt those components to existing VRDex tokens without adopting an entire new UI system. Keep persistent selected points in application state, as its migration guidance recommends. [Official chart documentation](https://ui.shadcn.com/docs/components/chart)

## Shortlist

| Candidate | Strongest case | Main cost / uncertainty | Position |
| --- | --- | --- | --- |
| Recharts + shadcn presentation | Familiar React composition, adaptable appearance and supplied accessibility layer; linked tooltip and brush behavior through `syncId`. | Bespoke drag zoom, persistent touch inspection and complete keyboard drilldown require application work and testing. | First challenger to ECharts. |
| visx | Build genuinely custom React visualizations using established D3-backed primitives; own the layout and interaction design. | More chart engineering: navigation, hit targets, focus behavior, resizing and shared state need deliberate composition. | Best interpretation of “roll our own” if conventional charts constrain the design. |
| Nivo | Ready-made React chart families with configurable presentation; line charts offer SVG/Canvas choices and explicit null-data holes. | Linked exploration and product navigation remain app-owned; accessibility and touch behavior must be tested for each chosen renderer. | Credible polished-dashboard option, weaker reason to prefer it specifically for this exploration workflow. |

Recharts documents `syncId` and `syncMethod`: the default index synchronization assumes aligned arrays. Use timestamp/value synchronization or a custom method when observations differ. Do not connect charts merely because their arrays happen to have equal lengths. [Recharts API](https://recharts.github.io/en-US/api/)

visx combines React with D3 calculation primitives and supports selective package use. Its current README identifies v4 as stable for React 18/19. [Project README](https://raw.githubusercontent.com/airbnb/visx/master/README.md) `XYChart` supplies series, themes, annotations, tooltips, null-data support, pointer events covering mouse/touch, and focus/blur hooks for keyboard integration. These hooks are building blocks, not proof of a finished accessible dashboard. Its newer primitive theme layer supports CSS-variable scoping and shadcn-style tokens. [XYChart documentation](https://raw.githubusercontent.com/airbnb/visx/master/packages/visx-xychart/README.md)

Nivo line charts explicitly treat null x/y values as holes; its official gallery includes time scales and custom layers. [Line documentation](https://nivo.rocks/line/) Its source manifest declares MIT licensing and React 19 support; visx XYChart also declares MIT and React 19 peers. These source manifests are not verification of the exact npm release we would install or Next 16 runtime behavior. [Nivo manifest](https://raw.githubusercontent.com/plouc/nivo/master/packages/line/package.json), [visx manifest](https://raw.githubusercontent.com/airbnb/visx/master/packages/visx-xychart/package.json)

## The product should own these behaviors

- Month view selects a day, then a specific instance. Each transition loads the appropriate data grain. Back restores the prior interval, filters and scroll position; browser history should agree with the visible navigation.
- Hover previews; tap or keyboard selection opens persistent details. Provide ordinary date controls and an inspectable table. Chart hover must not be the sole path to information.
- Keep one selected interval and timezone across linked charts. Missing collection coverage must remain missing, rather than becoming zero or an interpolated attendance claim.
- Candidate personal home customization could choose and order approved widgets and remember an optional preferred range. Owner-set club defaults plus personal overrides remain pending Q8. Widget configuration grants no data permission, including saved views after a role is removed.
- Responsive widgets need explicit minimum height and stable identities when reordered. Test the eventual approved dashboard layout; custom resizing is not an approved requirement.

These are design recommendations rather than claims that a library provides them. Chart selection does not supply the staff system, bot onboarding, dashboard layout editor, query cache, or authorization.

## Fair prototype decision

Compare Recharts/shadcn and ECharts using the same small interaction slice, data and design tokens before choosing the engine for the full dashboard preview. Include 30 days of daily occupancy and membership buckets, finer day data, one coverage outage, instance selection, linked cursor, reset/back and responsive widgets. Verify mouse, touch, keyboard, screen-reader inspection, daylight-saving boundaries, reduced motion and navigation cleanup. Measure the actual lazy-loaded chunk and interaction latency rather than quoting package marketing or unrepresentative bundle estimates.

Choose Recharts if it delivers the requested inspection without substantial custom interaction machinery. Choose ECharts if continuous range exploration and linked navigation are materially better and its accessibility work is acceptable. Escalate to visx only if concrete visual or interaction requirements justify owning more chart behavior. Pure SVG/D3 from scratch remains possible, but should beat visx on a demonstrated need before we own axes, coordinate math and hit testing ourselves.

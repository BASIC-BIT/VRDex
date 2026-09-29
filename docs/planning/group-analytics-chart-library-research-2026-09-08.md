# Group analytics chart library research

Research date: 2026-09-08. Status: current recommendation, not an installed dependency or final design decision. Official project documentation, source manifests, and licenses only. No packages installed or application code changed.

## Recommendation

Use **Apache ECharts** for the analytics workspace, inside one small VRDex-owned React client component. Its built-in range slider, touch/mouse zoom, selection, events, and chart linking fit the requested exploratory experience. Keep the existing Tailwind controls, spacing, typography, and colors around it. Do not introduce a second UI system just to obtain charts.

This is a judgment from the feature comparison below, not a performance benchmark. **Recharts is the credible simpler alternative** if the desired interaction is primarily clicking a day, opening details, and selecting a date range with ordinary controls. **Highcharts is technically strong but not the default** for an open-source, self-hostable product because its commercial licensing adds a separate distribution/procurement decision.

## Comparison

| Need | Apache ECharts | Recharts, optionally borrowing shadcn presentation | Highcharts |
| --- | --- | --- | --- |
| Month to day drilldown and back | Click events and option updates support app-owned drilldown. [Events](https://echarts.apache.org/handbook/en/concepts/event/) | React click handlers and controlled data/domain support app-owned drilldown. [LineChart](https://recharts.github.io/en-US/api/LineChart/) | Dedicated drilldown module with drill-up behavior. [Drilldown](https://www.highcharts.com/docs/chart-concepts/drilldown) |
| Range selection, zoom, pan | Built-in inside, slider, and marquee zoom, including finger interaction. [Source docs](https://raw.githubusercontent.com/apache/echarts-doc/master/en/option/component/data-zoom.md) | Brush supports range selection and synchronized zoom/pan. Arbitrary drag-to-zoom behavior needs application composition. [Brush](https://recharts.github.io/en-US/api/Brush/) | Built-in zoom behavior, including touch options. [Zooming](https://www.highcharts.com/docs/chart-concepts/zooming) |
| Linked charts | `echarts.connect` links chart instances; app-owned time state remains useful for data queries. [API source](https://raw.githubusercontent.com/apache/echarts-doc/master/en/api/echarts.md) | `syncId` synchronizes charts, including brush behavior. [Brush](https://recharts.github.io/en-US/api/Brush/) | Strong event APIs; coordination across charts still needs application wiring for this dashboard. No requirement here to purchase a separate dashboard product. |
| Hover details and styling | Configurable tooltips/events and theme options. [Events](https://echarts.apache.org/handbook/en/concepts/event/) | React tooltip content fits existing components. shadcn provides Recharts-based containers, tooltips, legends, CSS-variable theming, not a separate chart engine. [shadcn chart](https://ui.shadcn.com/docs/components/chart) | Configurable chart engine with documented React integration. [Next.js](https://www.highcharts.com/docs/react/nextjs) |
| Missing time-series data | `connectNulls` setting allows disconnected lines. [Line source](https://raw.githubusercontent.com/apache/echarts-doc/master/en/option/series/line.md) | `connectNulls` defaults false. [Line](https://recharts.github.io/en-US/api/Line/) | `connectNulls` controls gap drawing. [API](https://api.highcharts.com/highcharts/plotOptions.series.connectNulls) |
| Accessibility | ARIA descriptions and decal patterns; module must be enabled. This documentation does not establish full keyboard point navigation. [ARIA](https://echarts.apache.org/handbook/en/best-practices/aria/) | `accessibilityLayer` adds keyboard and screen-reader support. [shadcn documentation](https://ui.shadcn.com/docs/components/chart) | Dedicated accessibility module, included with licenses. [Accessibility](https://www.highcharts.com/docs/accessibility/accessibility-module) |
| React 19 / Next 16 fit | Framework-independent engine. Proposed client wrapper owns initialization, updates, resize, and disposal. Exact repository compatibility needs a prototype. [Imports](https://echarts.apache.org/handbook/en/basics/import/) | Current source manifest explicitly includes React 19 peer support. Exact pinned release and Next 16 behavior still need verification. [Manifest](https://raw.githubusercontent.com/recharts/recharts/main/package.json) | Official Next App Router guidance requires client components and shows the official React package. Exact chosen package version needs verification. [Next.js](https://www.highcharts.com/docs/react/nextjs) |
| License | Apache-2.0. [License](https://raw.githubusercontent.com/apache/echarts/master/LICENSE) | MIT. [License](https://raw.githubusercontent.com/recharts/recharts/main/LICENSE) | Vendor says production/commercial use requires a commercial license. [Download](https://www.highcharts.com/download/), [current EULA](https://shop.highcharts.com/license-eula) |

No current Highcharts dollar amount is quoted: the appropriate license scope for hosted VRDex plus third-party self-hosting has not been established. Confirm redistribution/self-hosting rights and obtain the applicable quote before selecting it. Open-sourcing VRDex does not itself establish a commercial-license exemption.

## Interaction contract the library cannot supply

Clicking a day in the month view should change the selected interval and fetch the finer-grained data for that day. It must not merely stretch daily totals across a wider canvas. Back/zoom-out restores the preceding range. Keep the selected date range, grain, timezone, and filters in application state so all charts and the detail table agree.

Use a shared hover/cursor for charts whose timestamps align, a persistent selection for details, an explicit reset/back control, and an accessible date-range control. On touch, tap selects a point and shows persistent details; hover is never the only way to inspect a value. Avoid hijacking ordinary page scrolling with wheel zoom.

Represent outages with explicit missing points or split segments, leaving `connectNulls` false. A time-axis library cannot detect a coverage gap when the backend simply omits the timestamps. Show coverage separately, including in hover details. Membership counts, joins, leaves, occupancy, and unique observed attendees need distinct units and definitions.

For ECharts, add ordinary keyboard-operable range/drill controls and an accessible data table alongside the graph. ARIA summaries alone do not satisfy detailed inspection. Apply reduced-motion preferences and color-independent distinctions. These are required product behaviors regardless of engine.

## Small validation before committing to the dependency

Build one disposable population chart with a month of daily buckets, click-to-day detail, one real-looking coverage gap, linked membership chart, and back control. Verify mouse, keyboard, screen reader, touch, dark/light appearance, resize, navigation cleanup, and representative data volume. Measure the actual lazy-loaded chart chunk. ECharts supports selective imports and either Canvas or SVG; choose from measured results rather than assuming a bundle or rendering advantage. [Import guidance](https://echarts.apache.org/handbook/en/basics/import/)

The prototype should decide whether ECharts' richer built-in exploration outweighs its imperative integration and accessibility work. If it does not, use Recharts with the same application interaction contract. Do not maintain both engines for this feature.

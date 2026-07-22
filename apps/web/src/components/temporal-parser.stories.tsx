import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { TemporalParseCompletedResponse } from "@vrdex/api-contracts";

import { TemporalParserSurface } from "@/app/time/temporal-parser";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

const resolvedResult = {
  requestId: "preview",
  status: "resolved",
  kind: "time_range",
  confidence: 0.96,
  method: "trained_plan",
  range: {
    start: {
      epoch: 1784937600,
      canonical: {
        isoInstant: "2026-07-25T00:00:00.000Z",
        zonedDateTime: "2026-07-24T20:00:00-04:00[America/New_York]",
        timeZone: "America/New_York",
        precision: "relative",
        weekday: "friday",
      },
    },
    end: {
      epoch: 1784941200,
      canonical: {
        isoInstant: "2026-07-25T01:00:00.000Z",
        zonedDateTime: "2026-07-24T21:00:00-04:00[America/New_York]",
        timeZone: "America/New_York",
        precision: "relative",
        weekday: "friday",
      },
    },
  },
  assumptions: [],
} satisfies TemporalParseCompletedResponse;

const meta = {
  title: "Features/Temporal Parser",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TemporalParserSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Resolved: Story = {
  render: () => (
    <PageShell tone="public">
      <PageContainer max="4xl">
        <PageNav accountMode="signed-out">
          <BrandLink />
        </PageNav>
        <header className="py-5 sm:py-8">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">VRDex Time</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Turn phrases like “next Friday at 8” into an exact time or range.
          </p>
        </header>
        <TemporalParserSurface
          contextInitiallyOpen
          country="US"
          error={null}
          locale="en-US"
          onCountryChange={() => undefined}
          onLocaleChange={() => undefined}
          onReferenceInstantChange={() => undefined}
          onRetentionChange={() => undefined}
          onSubmit={(event) => event.preventDefault()}
          onSubdivisionChange={() => undefined}
          onTextChange={() => undefined}
          onTimeZoneChange={() => undefined}
          referenceInstant=""
          result={resolvedResult}
          resultSummary="Friday, July 24, 2026, 8:00 PM–9:00 PM EDT"
          retainInput
          submitting={false}
          subdivision="IN"
          text="Next Friday from 8pm to 9pm Eastern"
          timeZone="America/New_York"
        />
      </PageContainer>
    </PageShell>
  ),
};
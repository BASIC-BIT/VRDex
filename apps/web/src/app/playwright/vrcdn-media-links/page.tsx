import { notFound } from "next/navigation";

import { VrcdnMediaLinkAssistant } from "../../_components/vrcdn-media-link-assistant";
import { Card, SectionTitle } from "@/components/ui/card";
import { Field, FieldText, Textarea } from "@/components/ui/field";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

export const dynamic = "force-dynamic";

const sampleMediaLinks = "vrcdn | VRCDN Quest link | https://stream.vrcdn.live/live/basicbit.live.ts | copy";

export default function VrcdnMediaLinksPreviewPage() {
  if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true") {
    notFound();
  }

  return (
    <PageShell tone="event">
      <PageContainer max="4xl">
        <Card className="grid gap-5" padding="lg" surface="white">
          <div className="grid gap-2">
            <SectionTitle>VRCDN media-link input</SectionTitle>
            <p className="text-sm leading-6 text-muted">Paste one VRCDN URL and VRDex derives the operational player links.</p>
          </div>
          <Field>
            Media links
            <Textarea className="min-h-24" readOnly value={sampleMediaLinks} />
            <FieldText>Fixture preview for Playwright snapshots.</FieldText>
          </Field>
          <VrcdnMediaLinkAssistant mediaLinksText={sampleMediaLinks} />
        </Card>
      </PageContainer>
    </PageShell>
  );
}

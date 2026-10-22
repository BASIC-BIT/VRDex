import Link from "next/link";

import { EventDiscordExportPanel } from "../_components/event-discord-export-panel";
import { EventEditorForm, type EditableEvent } from "./event-editor-form";
import { buttonVariants } from "@/components/ui/button";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";

export function EventEditorPage({
  communityName,
  communitySlug,
  demoMode = false,
  savedTimezonePreference = null,
  discordPostText,
  event,
}: {
  communityName: string;
  communitySlug: string;
  demoMode?: boolean;
  savedTimezonePreference?: string | null;
  discordPostText?: string | null;
  event?: EditableEvent;
}) {
  const routePath = event === undefined ? undefined : `/${communitySlug}/events/${event.slug}`;

  return (
    <div className="ph-no-capture" data-ph-no-capture>
      <PageShell className="py-10">
        <PageContainer max="6xl">
          <PageNav>
            <BrandLink />
            {routePath ? <Link className={buttonVariants({ variant: "secondary" })} href={`${routePath}/operate`}>Broadcast controls</Link> : null}
            {event?.publicationState === "published" && routePath !== undefined ? (
              <Link className={buttonVariants({ variant: "secondary" })} href={routePath}>
                View event
              </Link>
            ) : event === undefined ? (
              <Link className={buttonVariants({ variant: "secondary" })} href="/account/events">
                Events
              </Link>
            ) : null}
          </PageNav>

          <EventEditorForm heading={<header className="pt-2">
            {event === undefined ? (
              <Link className="text-sm font-medium text-muted underline-offset-4 hover:underline" href={`/${communitySlug}`}>
                {communityName}
              </Link>
            ) : (
              <p className="text-sm font-medium text-muted">Edit event</p>
            )}
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {event?.title ?? "Add event"}
            </h1>
          </header>} communitySlug={communitySlug} communityName={communityName} demoMode={demoMode} event={event} savedTimezonePreference={savedTimezonePreference} />
          {discordPostText ? <EventDiscordExportPanel text={discordPostText} /> : null}
        </PageContainer>
      </PageShell>
    </div>
  );
}

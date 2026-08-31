"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { EventEditorPage } from "../../events/event-editor-page";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function EventEditorPreview() {
  return (
    <ConvexProvider client={previewClient}>
      <EventEditorPage communityName="Afterglow" communitySlug="afterglow" demoMode />
    </ConvexProvider>
  );
}

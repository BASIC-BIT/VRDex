"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { EventEditorPage } from "../../events/new/event-editor-page";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function EventEditorPreview() {
  return (
    <ConvexProvider client={previewClient}>
      <EventEditorPage demoMode />
    </ConvexProvider>
  );
}

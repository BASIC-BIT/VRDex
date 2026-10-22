"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { ConvexError, type Value } from "convex/values";
import { api } from "@convex-generated-api";
import { ManagedEventsPanel } from "@/app/account/events/managed-events-panel";
import { EventEditorPage } from "@/app/events/event-editor-page";
import { EventIntakeForm } from "@/app/events/event-intake-form";
import { EventPublicPage } from "@/app/_components/event-public-page";
import { BrandLink, PageContainer, PageNav, PageShell } from "@/components/ui/page-shell";
import { buttonVariants } from "@/components/ui/button";

type Snapshot = {
  editable: NonNullable<FunctionReturnType<typeof api.events.getEditableBySlug>>;
  draftId: string;
  discord: string | null;
  staffPublic: FunctionReturnType<typeof api.events.getPublicBySlug>;
  intakePublic: FunctionReturnType<typeof api.events.getPublicBySlug>;
};
type Request = { type: "query" | "mutation" | "action" | "snapshot"; name: string; args: Record<string, unknown> };
type Reply = { ok: true; result: unknown } | { ok: false; error: { message: string; data?: Value } };
declare global { interface Window { organizerCheckpoint: (request: Request) => Promise<Reply> } }
const fetchAccessToken = async () => "fixture-token";
const useFixtureAuth = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken });

// Checkpoint-only transport: every response comes from the real backend child.
// Native hooks own pagination; no row synthesis or cursor interpretation lives here.
function transport() {
  const cache = new Map<string, { value?: unknown; error?: Error }>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  async function request(type: Request["type"], name: string, args: Record<string, unknown>) {
    const reply = await window.organizerCheckpoint({ type, name, args });
    if (!reply.ok) throw reply.error.data !== undefined ? new ConvexError(reply.error.data) : new Error(reply.error.message);
    return reply.result;
  }
  async function command(type: "mutation" | "action", reference: FunctionReference<typeof type>, args: Record<string, unknown>) {
    const result = await request(type, getFunctionName(reference), args);
    // Convex keeps the last value until a new consistent query result arrives.
    // Returning undefined here would unmount ConnectedIntake during its save.
    await Promise.all([...cache.keys()].map(async key => {
      const [name, queryArgs] = JSON.parse(key) as [string, Record<string, unknown>];
      try { cache.set(key, { value: await request("query", name, queryArgs) }); }
      catch (error) { cache.set(key, { error: error instanceof Error ? error : new Error(String(error)) }); }
    }));
    notify();
    return result;
  }
  const client = {
    setAuth(_fetch: unknown, onChange: (authenticated: boolean) => void) { onChange(true); }, clearAuth() {}, logger: { warn() {} },
    query: (reference: FunctionReference<"query">, args: Record<string, unknown>) => request("query", getFunctionName(reference), args),
    mutation: (reference: FunctionReference<"mutation">, args: Record<string, unknown>) => command("mutation", reference, args),
    action: (reference: FunctionReference<"action">, args: Record<string, unknown>) => command("action", reference, args),
    watchQuery(reference: FunctionReference<"query">, args: Record<string, unknown>) {
      const name = getFunctionName(reference), key = JSON.stringify([name, args]);
      return {
        localQueryResult() {
          if (!cache.has(key)) {
            const entry: { value?: unknown; error?: Error } = {};
            cache.set(key, entry);
            void request("query", name, args).then(value => { entry.value = value; notify(); }, error => { entry.error = error; notify(); });
          }
          const entry = cache.get(key)!;
          if (entry.error) throw entry.error;
          return entry.value;
        },
        onUpdate(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, journal: () => undefined,
      };
    },
  } as unknown as ConvexReactClient;
  return { client, snapshot: () => request("snapshot", "", {}) as Promise<Snapshot> };
}
export function EventWorkspaceCheckpoint({ view }: { view: string }) {
  const [fixture] = useState(transport);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => { void fixture.snapshot().then(setSnapshot); }, [fixture]);
  if (!snapshot) return null;
  const publicEvent = view === "staff-public" ? snapshot.staffPublic : snapshot.intakePublic;
  return <ConvexProviderWithAuth client={fixture.client} useAuth={useFixtureAuth}>
    {view === "staff" ? <EventEditorPage communityName="Checkpoint Club" communitySlug="checkpoint-club" event={snapshot.editable} discordPostText={snapshot.discord} />
      : view.endsWith("-public") ? publicEvent ? <EventPublicPage event={publicEvent} /> : null
        : <PageShell className="py-10"><PageContainer max={view === "inventory" ? "5xl" : "6xl"}><PageNav showMyEvents={view !== "intake"}><BrandLink />{view === "intake" ? <Link className={buttonVariants({ variant: "secondary" })} href="/account/events">My events</Link> : null}</PageNav>
          {view === "intake" ? <EventIntakeForm heading={<h1 className="text-3xl font-semibold">Add event</h1>} draftId={snapshot.draftId} /> : <ManagedEventsPanel />}
        </PageContainer></PageShell>}
  </ConvexProviderWithAuth>;
}

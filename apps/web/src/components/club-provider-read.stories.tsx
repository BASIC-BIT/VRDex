import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import {
  ConvexProvider,
  ConvexReactClient,
  type Watch,
  type WatchQueryOptions,
  type MutationOptions,
} from "convex/react";
import {
  getFunctionName,
  type ArgsAndOptions,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import {
  useClubProviderRead,
  type ProviderReadResult,
} from "@/app/account/communities/[slug]/club-provider-read";
import type { Id } from "../../../../convex/_generated/dataModel";

type Mode =
  | "succeeded"
  | "pending"
  | "running"
  | "failed"
  | "stale"
  | "denied"
  | "expired";

// Model Convex's argument-keyed cache and a server clock independent of Date.now.
// Remounts share this client, so missing attempt nonces really do replay old TTLs.
class ReadFixtureClient extends ConvexReactClient {
  private readonly fixtureListeners = new Set<() => void>();
  private readonly cache = new Map<string, ProviderReadResult | Error | null>();
  private readonly evaluatedKeys = new Set<string>();
  holdNewEvaluations = false;
  private readonly startedAt = performance.now();
  private observedAt = this.serverNow() - 45_000;
  private generation = 0;
  mode: Mode = "succeeded";

  constructor() {
    super("https://fixture.invalid");
  }
  private serverNow() {
    return 1_800_000_000_000 + performance.now() - this.startedAt;
  }
  change(mode: Mode, newObservation = false) {
    this.mode = mode;
    if (newObservation) {
      this.observedAt = this.serverNow();
      this.generation++;
    }
    this.cache.clear();
    this.fixtureListeners.forEach((listener) => listener());
  }
  replay() {
    for (const [key, result] of this.cache) {
      if (result && !(result instanceof Error))
        this.cache.set(key, structuredClone(result));
    }
    this.fixtureListeners.forEach((listener) => listener());
  }
  release() {
    this.holdNewEvaluations = false;
    this.fixtureListeners.forEach((listener) => listener());
  }
  hold() {
    this.holdNewEvaluations = true;
  }
  override watchQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: ArgsAndOptions<Query, WatchQueryOptions>
  ): Watch<FunctionReturnType<Query>> {
    if (getFunctionName(query) !== "clubProviderReads:get")
      throw new Error("Unexpected query");
    const key = JSON.stringify(args[0]);
    return {
      onUpdate: (callback) => {
        this.fixtureListeners.add(callback);
        return () => this.fixtureListeners.delete(callback);
      },
      localQueryResult: () => {
        if (this.holdNewEvaluations && !this.evaluatedKeys.has(key))
          return undefined;
        this.evaluatedKeys.add(key);
        if (!this.cache.has(key)) {
          const remainingFreshMs = Math.max(
            0,
            this.observedAt + 60_000 - this.serverNow(),
          );
          const result: ProviderReadResult | Error | null =
            this.mode === "denied"
              ? new Error("Read access expired.")
              : this.mode === "expired"
                ? null
                : {
                    state: this.mode === "stale" ? "succeeded" : this.mode,
                    result: ["succeeded", "stale", "failed"].includes(this.mode)
                      ? {
                          items: [{ id: "member" }],
                          nextOffset: null,
                          observedAt: this.observedAt,
                        }
                      : null,
                    errorCode:
                      this.mode === "failed" ? "provider_read_failed" : null,
                    // Deliberately optimistic duration for stale/failed evidence tests.
                    fresh: this.mode !== "stale" && remainingFreshMs > 0,
                    remainingFreshMs,
                  };
          this.cache.set(key, result);
        }
        const result = this.cache.get(key);
        if (result instanceof Error) throw result;
        return result as FunctionReturnType<Query>;
      },
      journal: () => undefined,
    };
  }
  override async mutation<Mutation extends FunctionReference<"mutation">>(
    mutation: Mutation,
    ...args: ArgsAndOptions<Mutation, MutationOptions<FunctionArgs<Mutation>>>
  ): Promise<FunctionReturnType<Mutation>> {
    if (getFunctionName(mutation) !== "clubProviderReads:request")
      throw new Error("Unexpected mutation");
    const { params } = args[0] as { params: { offset: number } };
    return `read-${this.generation}-${params.offset}` as FunctionReturnType<Mutation>;
  }
}

function Read({ offset }: { offset: number | null }) {
  const read = useClubProviderRead(
    "fixture-profile" as Id<"profiles">,
    offset === null ? null : { kind: "members", n: 10, offset },
  );
  return (
    <>
      <output data-testid="fresh">{String(read.fresh)}</output>
      <output data-testid="loading">{String(read.loading)}</output>
      <output data-testid="error">{read.error}</output>
      <button disabled={!read.fresh}>Act</button>
      <button onClick={read.refresh}>Refresh</button>
    </>
  );
}
function Fixture() {
  const [client] = useState(() => new ReadFixtureClient());
  const [mount, setMount] = useState(0);
  const [render, setRender] = useState(0);
  const [offset, setOffset] = useState<number | null>(0);
  return (
    <ConvexProvider client={client}>
      <Read key={mount} offset={offset} />
      <output>{render}</output>
      <button onClick={() => setRender((n) => n + 1)}>Rerender</button>
      <button onClick={() => client.replay()}>Replay</button>
      <button onClick={() => setMount((n) => n + 1)}>Remount</button>
      <button onClick={() => setOffset(1)}>Next page</button>
      <button onClick={() => setOffset(null)}>Clear params</button>
      <button onClick={() => client.change("pending")}>Pending</button>
      <button onClick={() => client.change("running")}>Running</button>
      <button onClick={() => client.change("succeeded", true)}>
        Complete read
      </button>
      <button onClick={() => client.hold()}>Hold evaluation</button>
      <button onClick={() => client.release()}>Release evaluation</button>
      <button onClick={() => client.change("stale")}>Server stale</button>
      <button onClick={() => client.change("failed")}>Server failed</button>
      <button onClick={() => client.change("denied")}>Revoke access</button>
      <button onClick={() => client.change("expired")}>Expire request</button>
    </ConvexProvider>
  );
}
const meta = {
  title: "Clubs/Provider read",
  component: Fixture,
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Freshness: Story = {};

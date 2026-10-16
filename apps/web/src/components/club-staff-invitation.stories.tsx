import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference, type FunctionReturnType, type OptionalRestArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { ClubInvitation } from "@/app/account/communities/[slug]/club-invitation";
import { ClubErrorBoundary } from "@/app/account/communities/[slug]/club-workspace";
import { PageContainer, PageShell } from "@/components/ui/page-shell";

class InvitationClient extends ConvexReactClient {
  previews = 0;
  accepts = 0;
  fail = false;
  release: (() => void) | undefined;
  hold = false;
  constructor() { super("https://fixture.invalid"); }
  override setAuth(...args: Parameters<ConvexReactClient["setAuth"]>) {
    args[1]?.(true);
  }
  override watchQuery(): never { throw new Error("Invitation previews must use the throttled action."); }
  recover() { this.fail = false; }
  override async action<Action extends FunctionReference<"action">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>> {
    const input: unknown = args[0];
    if (!input || typeof input !== "object" || !("token" in input) ||
      typeof input.token !== "string" || !/^[A-Za-z0-9_-]{10}$/.test(input.token))
      throw new Error("Expected the current ten-character invitation token.");
    const name = getFunctionName(action);
    if (name === "clubStaff:acceptStaffInvitation") {
      this.accepts++;
      throw new ConvexError({ code: "EMAIL_NOT_VERIFIED" });
    }
    if (name !== "clubStaff:getInvitation") throw new Error("Unexpected action");
    this.previews++;
    const nameAtRequest = this.previews === 1 ? "Afterhours" : "Second club";
    if (this.hold && this.previews === 1) await new Promise<void>((resolve) => { this.release = resolve; });
    if (this.fail) throw new ConvexError({ code: "STAFF_INVITATION_RATE_LIMITED", retryAfterMs: 60_000 });
    // This transport fixture supplies the validator-shaped response of the real action.
    return {
      community: { displayName: nameAtRequest, slug: "afterhours" },
      roles: [{ _id: "fixture-role", label: "Event staff" }],
      expiresAt: Date.UTC(2026, 10, 1),
    } as FunctionReturnType<Action>;
  }
}

const fetchAccessToken = async () => "fixture-token";
function InvitationFixture({ signedIn = false, fail = false, hold = false }) {
  const [client] = useState(() => {
    const value = new InvitationClient();
    value.fail = fail;
    value.hold = hold;
    return value;
  });
  const [revision, setRevision] = useState(0);
  const [token, setToken] = useState("A_b-0123Zz");
  function useFixtureAuth() {
    return { isLoading: false, isAuthenticated: signedIn, fetchAccessToken };
  }
  return <ConvexProviderWithAuth client={client} useAuth={useFixtureAuth}>
    <PageShell><PageContainer max="3xl">
      <ClubErrorBoundary><ClubInvitation communitySlug="afterhours" token={token} /></ClubErrorBoundary>
      <button onClick={() => setRevision((value) => value + 1)}>Rerender</button>
      <button onClick={() => setToken("B_b-0123Zz")}>Next invitation</button>
      <button onClick={() => { client.release?.(); }}>Release first preview</button>
      <button onClick={() => client.recover()}>Recover service</button>
      <output aria-label="Preview calls" data-revision={revision}>{client.previews}</output>
      <output aria-label="Acceptance calls">{client.accepts}</output>
    </PageContainer></PageShell>
  </ConvexProviderWithAuth>;
}
const meta = {
  title: "Clubs/Staff invitation",
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Anonymous: Story = { render: () => <InvitationFixture /> };
export const SignedIn: Story = { render: () => <InvitationFixture signedIn /> };
export const Unavailable: Story = { render: () => <InvitationFixture fail /> };
export const SlowPreview: Story = { render: () => <InvitationFixture hold /> };

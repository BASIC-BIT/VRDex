import type { Metadata } from "next";

import { HandoffInvitation } from "./handoff-invitation";
import { getHandoffPlaywrightFixture } from "./handoff-fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile invitation | VRDex",
  referrer: "no-referrer",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function HandoffPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <HandoffInvitation
      fixture={getHandoffPlaywrightFixture(token)}
      token={token}
    />
  );
}

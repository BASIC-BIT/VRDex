import { HandoffInvitation } from "./handoff-invitation";
import { getHandoffPlaywrightFixture } from "./handoff-fixtures";

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

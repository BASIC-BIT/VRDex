import { DiscoveryLandingPage } from "./_components/discovery-public-page";
import { fetchDiscovery, fetchHomeActiveWorlds } from "@/convex/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [activeWorlds, discovery] = await Promise.all([fetchHomeActiveWorlds(), fetchDiscovery()]);

  return (
    <DiscoveryLandingPage
      activeWorldStatus={activeWorlds.kind}
      activeWorlds={activeWorlds.worlds}
      data={discovery.data}
      status={discovery.kind}
    />
  );
}

"use client";
import { CommunityTelemetryDashboard } from "./telemetry/community-telemetry-dashboard";
import { useClubWorkspace } from "./club-workspace";

export function ClubHome() {
  const data = useClubWorkspace();
  return (
    <CommunityTelemetryDashboard
      communitySlug={data.community.slug}
      canManageIntegrations={
        data.actor.kind === "owner" ||
        data.actor.permissions.includes("manage_integrations")
      }
    />
  );
}

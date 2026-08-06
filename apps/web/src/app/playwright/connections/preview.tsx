"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

import { ConnectionsPanel } from "@/app/account/connections/connections-panel";

const previewClient = new ConvexReactClient("https://playwright-preview.convex.cloud");

export function ConnectionsPanelPreview({ community = false }: { community?: boolean }) {
  return (
    <ConvexProvider client={previewClient}>
      <ConnectionsPanel
        delegationEnabled
        initialProfileSlug={community ? "playwright-afterglow-social" : "basicbit"}
        preview={{
          ownedProfiles: community
            ? [
                {
                  slug: "playwright-afterglow-social",
                  displayName: "Afterglow Social",
                  profileType: "community",
                },
              ]
            : [{ slug: "basicbit", displayName: "BASICBIT", profileType: "person" }],
          connections: community
            ? [
                {
                  id: "playwright-guild-link",
                  assetType: "discord_guild",
                  assetExternalId: "100000000000000001",
                  assetDisplayName: "Afterglow Social",
                  linkRole: "primary",
                  verified: true,
                },
                {
                  id: "playwright-group-link",
                  assetType: "vrchat_group",
                  assetExternalId: "grp_00000000-0000-4000-8000-000000000001",
                  assetDisplayName: "Afterglow Harbor",
                  linkRole: "secondary",
                  verified: true,
                },
              ]
            : [
                {
                  id: "playwright-user-link",
                  assetType: "vrchat_user",
                  assetExternalId: "usr_00000000-0000-4000-8000-000000000001",
                  assetDisplayName: "BASICBIT",
                  linkRole: "primary",
                  verified: true,
                },
              ],
          available: community
            ? [
                {
                  assetType: "discord_guild",
                  assetExternalId: "100000000000000002",
                  assetDisplayName: "Afterglow Staff",
                  controlLevel: "administrator",
                },
              ]
            : [],
          credentials: community
            ? [{ guildId: "100000000000000001", lastUsedAt: Date.UTC(2024, 11, 24, 18, 0, 0) }]
            : [],
        }}
      />
    </ConvexProvider>
  );
}

"use client";

import type { ReactNode } from "react";
import { EntityImage } from "@/components/ui/entity-image";
import { ProfileAvatarImage } from "@/components/ui/profile-avatar-image";
import { VerifiedTrustMark } from "@/components/ui/verified-trust-mark";
import type { EventIdentityOption } from "@/lib/event-editor-identity";

export function ProfileSuggestion({
  option,
}: {
  option: EventIdentityOption;
}): ReactNode {
  return (
    <>
      <span className="relative inline-flex shrink-0">
        {option.imageKind === "logo" ? (
          <EntityImage
            alt=""
            className="lookup-suggestion-avatar lookup-avatar--logo h-[38px] w-[38px]"
            imageClassName="object-contain"
            label={option.title}
            sizes="38px"
            src={option.imageUrl}
          />
        ) : (
          <ProfileAvatarImage
            alt=""
            appearance={option.appearance}
            className="lookup-suggestion-avatar h-[38px] w-[38px]"
            label={option.title}
            sizes="38px"
            src={option.imageUrl}
          />
        )}
        {option.trustLabel === "claimed_verified" ? (
          <VerifiedTrustMark className="verified-trust-mark--avatar" />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{option.title}</span>
        {option.context ? (
          <span className="block truncate text-xs text-muted">
            {option.context}
          </span>
        ) : null}
        {option.trustLabel === "community_submitted" ||
        option.trustLabel === "unclaimed" ? (
          <span className="block text-xs text-muted">
            {option.trustLabel === "community_submitted"
              ? "Community submitted"
              : "Unclaimed"}
          </span>
        ) : null}
      </span>
    </>
  );
}

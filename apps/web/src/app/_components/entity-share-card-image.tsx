import type { PublicProfileShareCard } from "../../../../../convex/_profileShareCard";
import { absolutePublicUrl } from "@/lib/public-site-url";
import {
  profileInitials,
  profileShareImageDescription,
  profileShareNameFontSize,
  profileShareTrustNote,
} from "@/lib/profile-share-card";

export const entityShareImageSize = { width: 1200, height: 630 } as const;

export function EntityShareCardImage({ profile }: { profile: PublicProfileShareCard | null }) {
  const displayName = profile?.displayName ?? "VRDex";
  const summary = profile ? profileShareImageDescription(profile) : undefined;
  const trustNote = profile ? profileShareTrustNote(profile) : undefined;
  const avatarImageUrl = profile?.avatarImageUrl
    ? absolutePublicUrl(profile.avatarImageUrl)
    : undefined;
  const bannerImageUrl = profile?.bannerImageUrl
    ? absolutePublicUrl(profile.bannerImageUrl)
    : undefined;
  const avatarObjectFit = profile?.avatarImageKind === "logo" ? "contain" : "cover";

  return (
    <div
      style={{
        alignItems: "stretch",
        background: "#08090d",
        color: "#f5f7fb",
        display: "flex",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      {bannerImageUrl ? (
        // `next/image` is not available inside a generated `ImageResponse` tree.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          height={630}
          src={bannerImageUrl}
          style={{ height: "100%", objectFit: "cover", opacity: 0.36, position: "absolute", width: "100%" }}
          width={1200}
        />
      ) : null}
      <div
        style={{
          background: bannerImageUrl
            ? "linear-gradient(90deg, rgba(8,9,13,0.98) 0%, rgba(8,9,13,0.88) 48%, rgba(8,9,13,0.42) 100%)"
            : "#08090d",
          display: "flex",
          height: "100%",
          position: "absolute",
          width: "100%",
        }}
      />
      <div
        style={{
          alignItems: "stretch",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 68px 64px",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", fontSize: 25, fontWeight: 700, letterSpacing: "0.18em" }}>
          <span style={{ color: "#8ed8ff", display: "flex" }}>VR</span>
          <span style={{ display: "flex" }}>DEX</span>
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 42, maxWidth: 1030 }}>
          {avatarImageUrl ? (
            <div
              style={{
                alignItems: "center",
                background: profile?.avatarImageKind === "logo" ? "rgba(245,247,251,0.06)" : "#151b24",
                border: "2px solid rgba(245,247,251,0.24)",
                borderRadius: 28,
                display: "flex",
                flex: "0 0 184px",
                height: 184,
                justifyContent: "center",
                overflow: "hidden",
                padding: profile?.avatarImageKind === "logo" ? 18 : 0,
                width: 184,
              }}
            >
              {/* `next/image` is not available inside a generated `ImageResponse` tree. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                height={184}
                src={avatarImageUrl}
                style={{ height: "100%", objectFit: avatarObjectFit, width: "100%" }}
                width={184}
              />
            </div>
          ) : (
            <div
              style={{
                alignItems: "center",
                background: "rgba(142,216,255,0.12)",
                border: "2px solid rgba(142,216,255,0.32)",
                borderRadius: 28,
                color: "#c7ecff",
                display: "flex",
                flex: "0 0 184px",
                fontSize: 58,
                fontWeight: 700,
                height: 184,
                justifyContent: "center",
                letterSpacing: "-0.04em",
                width: 184,
              }}
            >
              {profileInitials(displayName)}
            </div>
          )}
          <div style={{ alignItems: "flex-start", display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                fontSize: profileShareNameFontSize(displayName),
                fontWeight: 650,
                letterSpacing: "-0.045em",
                lineHeight: 1.02,
                maxWidth: 780,
                wordBreak: "break-all",
              }}
            >
              {displayName}
            </div>
            {summary ? (
              <div
                style={{
                  color: "#b9c2cf",
                  display: "flex",
                  fontSize: 28,
                  lineHeight: 1.32,
                  marginTop: 22,
                  maxWidth: 760,
                  wordBreak: "break-all",
                }}
              >
                {summary}
              </div>
            ) : null}
            {trustNote ? (
              <div
                style={{
                  color: "#8e99a8",
                  display: "flex",
                  fontSize: 20,
                  marginTop: 14,
                }}
              >
                {trustNote}
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ background: "#8ed8ff", display: "flex", height: 4, width: 76 }} />
      </div>
    </div>
  );
}

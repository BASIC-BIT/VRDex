import type { PublicEventShareCard } from "../../../../../convex/_eventShareCard";
import {
  eventShareSchedule,
  eventShareTitleFontSize,
} from "@/lib/event-share-card";

export function EventShareCardImage({
  artworkImageUrl,
  event,
}: {
  artworkImageUrl?: string;
  event: PublicEventShareCard | null;
}) {
  const title = event?.title ?? "VRDex";
  const hasArtwork = artworkImageUrl !== undefined;

  return (
    <div
      style={{
        alignItems: "stretch",
        background: "#08090d",
        color: "#f5f7fb",
        display: "flex",
        height: "100%",
        width: "100%",
      }}
    >
      {hasArtwork ? (
        <div
          style={{
            alignItems: "center",
            background: "#101218",
            display: "flex",
            flex: "0 0 470px",
            justifyContent: "center",
            overflow: "hidden",
            padding: 28,
          }}
        >
          {/* `next/image` is not available inside an ImageResponse tree. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            height={574}
            src={artworkImageUrl}
            style={{ height: "100%", objectFit: "contain", width: "100%" }}
            width={414}
          />
        </div>
      ) : null}
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          minWidth: 0,
          padding: hasArtwork ? "58px 64px 62px" : "60px 68px 64px",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "0.18em",
          }}
        >
          <span style={{ color: "#8ed8ff", display: "flex" }}>VR</span>
          <span style={{ display: "flex" }}>DEX</span>
        </div>

        <div style={{ alignItems: "flex-start", display: "flex", flexDirection: "column", maxWidth: hasArtwork ? 600 : 1000 }}>
          {event?.status === "cancelled" ? (
            <div
              style={{
                color: "#f5a3a3",
                display: "flex",
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: "0.16em",
                marginBottom: 20,
                textTransform: "uppercase",
              }}
            >
              Cancelled
            </div>
          ) : null}
          {event ? (
            <div style={{ color: "#b9c2cf", display: "flex", fontSize: 25, marginBottom: 18 }}>
              {eventShareSchedule(event)}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: eventShareTitleFontSize(title),
              fontWeight: 650,
              letterSpacing: "-0.045em",
              lineHeight: 1.02,
              maxWidth: "100%",
              wordBreak: "break-word",
            }}
          >
            {title}
          </div>
          {event?.communityName ? (
            <div style={{ color: "#8e99a8", display: "flex", fontSize: 24, marginTop: 24 }}>
              {event.communityName}
            </div>
          ) : null}
        </div>

        <div style={{ background: "#8ed8ff", display: "flex", height: 4, width: 76 }} />
      </div>
    </div>
  );
}

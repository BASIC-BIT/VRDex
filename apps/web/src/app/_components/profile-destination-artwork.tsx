"use client";

import { Gamepad2, MessagesSquare, Users } from "lucide-react";
import { useState } from "react";

/** Fixed geometry keeps an unavailable image from moving the name or click target. */
export function ProfileDestinationArtwork({
  kind,
  src,
}: {
  kind: "vrchat_user" | "vrchat_group" | "discord_guild";
  src?: string;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const Icon = kind === "discord_guild" ? MessagesSquare : kind === "vrchat_group" ? Users : Gamepad2;
  return (
    <span aria-hidden="true" className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background text-muted">
      <Icon className="size-5" />
      {src && failedSource !== src ? (
        // Cached, sanitized provider thumbnails already have bounded dimensions.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="absolute inset-0 size-full object-cover" decoding="async" height={32}
          loading="lazy" onError={() => setFailedSource(src)} src={src} width={32} />
      ) : null}
    </span>
  );
}

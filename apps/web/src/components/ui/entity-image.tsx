"use client";

import Image from "next/image";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { safeImageUrl } from "@/lib/safe-image";

function initialsFor(label: string): string {
  return (
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "VR"
  );
}

export function EntityImage({
  alt,
  className,
  fallback,
  imageClassName,
  label,
  priority,
  sizes,
  src,
  ...props
}: Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  alt?: string;
  className?: string;
  fallback?: ReactNode;
  imageClassName?: string;
  label: string;
  priority?: boolean;
  sizes?: string;
  src?: string | null;
}) {
  const imageUrl = safeImageUrl(src ?? undefined);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = imageUrl !== undefined && failedUrl === imageUrl;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-strong text-sm font-semibold text-muted",
        className,
      )}
      {...props}
      aria-hidden={alt === "" ? true : props["aria-hidden"]}
    >
      {imageUrl && !failed ? (
        <Image
          alt={alt ?? label}
          className={cn("object-cover", imageClassName)}
          fill
          priority={priority}
          sizes={sizes}
          src={imageUrl}
          unoptimized
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        fallback ?? initialsFor(label)
      )}
    </span>
  );
}

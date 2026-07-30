"use client";

import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { EntityImage } from "@/components/ui/entity-image";
import {
  avatarFrameStyle,
  defaultAvatarAppearance,
  type AvatarAppearance,
} from "@/lib/avatar-appearance";

export function ProfileAvatarImage({
  appearance,
  style,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof EntityImage>, "style"> & {
  appearance?: AvatarAppearance;
  style?: CSSProperties;
}) {
  return (
    <EntityImage
      {...props}
      style={avatarFrameStyle(style, appearance ?? defaultAvatarAppearance)}
    />
  );
}

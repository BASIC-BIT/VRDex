import type { CSSProperties } from "react";

export type AvatarAppearance = {
  borderEnabled: boolean;
  borderColor: string;
  borderWidthPx: number;
  borderSoftnessPx: number;
  radiusPercent: number;
};

export const defaultAvatarAppearance: AvatarAppearance = {
  borderEnabled: true,
  borderColor: "#ffffff",
  borderWidthPx: 3,
  borderSoftnessPx: 0,
  radiusPercent: 18,
};

function hexToRgba(color: string, alpha: number): string {
  const match = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);

  if (!match) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const [, red, green, blue] = match;

  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`;
}

export function avatarFrameStyle(
  imageStyle: CSSProperties | undefined,
  appearance: AvatarAppearance,
): CSSProperties {
  const borderWidth = appearance.borderEnabled ? appearance.borderWidthPx : 0;
  const softness = appearance.borderEnabled ? appearance.borderSoftnessPx : 0;

  return {
    ...imageStyle,
    borderColor: appearance.borderEnabled ? appearance.borderColor : "transparent",
    borderRadius: `${appearance.radiusPercent}%`,
    borderStyle: "solid",
    borderWidth,
    boxShadow: softness > 0
      ? `0 0 ${softness}px ${Math.max(1, Math.round(softness / 3))}px ${hexToRgba(appearance.borderColor, 0.38)}`
      : undefined,
  };
}

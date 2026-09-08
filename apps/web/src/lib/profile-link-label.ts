import { profileLinkDestinationKey, type ProfileLinkType } from "../../../../convex/_profileLinks";

export function labelForEditedDestination(
  original: { type: ProfileLinkType; url: string; label?: string } | undefined,
  nextUrl: string,
  currentLabel: string,
  labelEdited: boolean,
): string {
  if (labelEdited) return currentLabel;
  if (!original) return "";
  return profileLinkDestinationKey({ type: original.type, url: nextUrl }) === profileLinkDestinationKey(original)
    ? original.label ?? ""
    : "";
}

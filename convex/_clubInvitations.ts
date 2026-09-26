import { v } from "convex/values";

export const invitationDestination = v.union(
  v.object({ kind: v.literal("group") }),
  v.object({
    kind: v.literal("instance"),
    worldId: v.string(),
    instanceId: v.string(),
  }),
  v.object({
    kind: v.literal("scheduled_instance"),
    creationOperationId: v.id("clubOperations"),
    creationRevision: v.number(),
  }),
);
export function normalizeRecipients(values: string[]): string[] {
  if (values.length > 100) throw new Error("Select at most 100 recipients.");
  const recipients = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  if (
    !recipients.length ||
    recipients.some(
      (value) =>
        !/^usr_[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
          value,
        ),
    )
  )
    throw new Error("Enter valid VRChat user IDs.");
  return recipients;
}

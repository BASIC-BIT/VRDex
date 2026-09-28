import { ConvexError } from "convex/values";
import { EventIntakeLocalTimeSchema, EventIntakeCandidateSchema, type EventIntakeCandidate, type EventIntakePatch, EventPosterDeclarationSchema, EVENT_POSTER_MAX_BYTES } from "../../../../packages/api-contracts/src/event-intake";

export function candidatePatch(candidate: EventIntakeCandidate): EventIntakePatch {
  const local = (time: string | null) => {
    const parsed = EventIntakeLocalTimeSchema.safeParse({ time });
    return parsed.success ? parsed.data : undefined;
  };
  const tentative: NonNullable<EventIntakePatch["tentative"]> = Object.fromEntries(Object.entries(candidate.event).flatMap(([key, value]) => {
    const field = key === "start" || key === "end" ? local(value) : value;
    return field ? [[key, field]] : [];
  }));
  if (candidate.lineup.length) tentative.lineup = candidate.lineup.map((row, index) => ({ clientKey: `extracted-${index}`, position: index,
    ...(row.performerLabel ? { performerLabel: row.performerLabel } : {}), ...(row.personSlug ? { personSlug: row.personSlug } : {}),
    ...(row.roleLabel ? { roleLabel: row.roleLabel } : {}), ...(local(row.start) ? { start: local(row.start) } : {}), ...(local(row.end) ? { end: local(row.end) } : {}),
  }));
  return { tentative, questions: candidate.questions.map(row => `${row.fieldPath}: ${row.reason}${row.alternatives.length ? ` (${row.alternatives.join(", ")})` : ""}`) };
}
export async function websiteIntakeCommand(operation: string, input: unknown) {
  const response = await fetch("/api/event-intake", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
  if (response.status === 409) throw new ConvexError({ code: "VERSION_CONFLICT" });
  if (!response.ok) throw new Error("INTAKE_UNAVAILABLE");
  return response.json();
}
export async function posterDeclaration(file: File) {
  if (file.size < 1 || file.size > EVENT_POSTER_MAX_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("INVALID_POSTER");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return EventPosterDeclarationSchema.parse({ contentType: file.type, byteLength: file.size, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("") });
}
export { EventIntakeCandidateSchema };


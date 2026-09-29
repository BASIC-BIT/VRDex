import { ConvexError } from "convex/values";
import { EventIntakeLocalTimeSchema, EventIntakeCandidateSchema, resolveEventLocalTime, type EventIntakeCandidate, type EventIntakePatch, EventPosterDeclarationSchema, EVENT_POSTER_MAX_BYTES } from "../../../../packages/api-contracts/src/event-intake";

export function candidatePatch(candidate: EventIntakeCandidate): EventIntakePatch {
  const questions = candidate.questions.map(row => `${row.fieldPath}: ${row.reason}${row.alternatives.length ? ` (${row.alternatives.join(", ")})` : ""}`);
  const ask = (path: string, reason: string) => {
    const question = `${path}: ${reason}`;
    if (questions.some(existing => existing.startsWith(question))) return;
    if (questions.length === 100) questions.pop();
    questions.push(question);
  };
  const local = (time: string | null, date: string | null, path: string) => {
    const parsed = EventIntakeLocalTimeSchema.safeParse({ time });
    if (!parsed.success) return undefined;
    if (!date) return parsed.data;
    const base = Date.parse(`${candidate.event.eventDate}T00:00:00Z`);
    const target = Date.parse(`${date}T00:00:00Z`);
    const offset = (target - base) / 86_400_000;
    if (!candidate.event.eventDate || !Number.isInteger(offset) || offset < -1 || offset > 7 || !candidate.event.timezone) {
      ask(path, "date_timezone_required"); return undefined;
    }
    try {
      const choices = resolveEventLocalTime(candidate.event.eventDate, { time: parsed.data.time, dayOffset: offset }, candidate.event.timezone);
      if (choices.length !== 1) { ask(path, choices.length ? "ambiguous_local_time" : "nonexistent_local_time"); return undefined; }
    } catch { ask(path, "invalid_local_time"); return undefined; }
    return { ...parsed.data, dayOffset: offset };
  };
  const tentative: NonNullable<EventIntakePatch["tentative"]> = Object.fromEntries(Object.entries(candidate.event).flatMap(([key, value]) => {
    if (key === "startDate" || key === "endDate") return [];
    const field = key === "start" ? local(candidate.event.start, candidate.event.startDate, "event.start")
      : key === "end" ? local(candidate.event.end, candidate.event.endDate, "event.end") : value;
    return field ? [[key, field]] : [];
  }));
  if (candidate.lineup.length) tentative.lineup = candidate.lineup.map((row, index) => {
    const start = local(row.start, row.startDate, `lineup.${index}.start`);
    const end = local(row.end, row.endDate, `lineup.${index}.end`);
    return { clientKey: `extracted-${index}`, position: index,
      ...(row.performerLabel ? { performerLabel: row.performerLabel } : {}), ...(row.personSlug ? { personSlug: row.personSlug } : {}),
      ...(row.roleLabel ? { roleLabel: row.roleLabel } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}),
    };
  });
  return { tentative, evidence: candidate.evidence, questions };
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


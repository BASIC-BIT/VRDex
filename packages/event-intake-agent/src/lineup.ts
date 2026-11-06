import type { EventIntakeCandidate } from "../../api-contracts/src/event-intake";
import { normalizeProfileName } from "../../../convex/_profileNameSearch";

export type PublicPersonMatch = { slug: string; displayName: string };
export type LineupLookup = { query: string; phase: "exact" | "prefix"; results: PublicPersonMatch[]; outcome: "ok" | "unavailable"; startedAt: number; endedAt: number };
type SearchPeople = (query: string, limit: number) => Promise<PublicPersonMatch[]>;
const LABEL_LIMIT = 8;
const LOOKUP_TIMEOUT_MS = 3_000;

// Only one insertion, deletion or substitution. This is a suggestion, never an identity decision.
function oneEditApart(left: string, right: string): boolean {
  const a = [...left], b = [...right];
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) === 1;
}

/** Required read-only resolution after extraction, independent of the model's optional tool calls. */
export async function resolveLineupPeople(candidate: EventIntakeCandidate, search: SearchPeople, observe?: (lookup: LineupLookup) => void): Promise<void> {
  if (candidate.decision.kind === "not_event") return;
  const cache = new Map<string, { matches: PublicPersonMatch[]; reason: string }>();
  const lookup = async (query: string, phase: LineupLookup["phase"]) => {
    const startedAt = Date.now();
    let results: PublicPersonMatch[] = [], outcome: LineupLookup["outcome"] = "ok";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rows = await Promise.race([search(query, 5), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("lookup_timeout")), LOOKUP_TIMEOUT_MS); })]);
      results = rows.slice(0, 5).filter(row => typeof row.slug === "string" && row.slug.length > 0 && row.slug.length <= 64 && typeof row.displayName === "string")
        .map(row => ({ slug: row.slug, displayName: row.displayName.slice(0, 120) }));
    } catch { outcome = "unavailable"; }
    finally { clearTimeout(timer); }
    try { observe?.({ query, phase, results, outcome, startedAt, endedAt: Date.now() }); } catch { /* a sink must not affect resolution */ }
    return { results, outcome };
  };
  for (const [index, row] of candidate.lineup.entries()) {
    const label = row.performerLabel?.trim(), normalized = label && normalizeProfileName(label);
    // revalidate has already checked any model-selected slug against actual tool results.
    if (row.personSlug) continue;
    if (!label || !normalized) continue;
    const fieldPath = `lineup.${index}.personSlug`;
    let resolution = cache.get(normalized);
    if (!resolution) {
      if (cache.size >= LABEL_LIMIT) resolution = { matches: [], reason: "identity_lookup_limit" };
      else {
        const exact = await lookup(label, "exact");
        const sameName = exact.results.filter(result => [result.displayName, result.slug].some(name => normalizeProfileName(name) === normalized));
        resolution = { matches: sameName, reason: exact.outcome === "ok" ? "unresolved_identity" : "identity_lookup_unavailable" };
        if (sameName.length) resolution.reason = sameName.length === 1 ? "exact" : "ambiguous_identity";
        // Long names only; require their first four normalized characters and at most one edit overall.
        else if (exact.outcome === "ok" && normalized.length >= 6) {
          const nearby = await lookup([...normalized].slice(0, 4).join(""), "prefix");
          const matches = nearby.results.filter(result => [result.displayName, result.slug].some(name => oneEditApart(normalized, normalizeProfileName(name))));
          resolution = { matches, reason: nearby.outcome !== "ok" ? "identity_lookup_unavailable" : "unresolved_identity" };
        }
        cache.set(normalized, resolution);
      }
    }
    candidate.questions = candidate.questions.filter(question => question.fieldPath !== fieldPath);
    const match = resolution.matches[0];
    if (resolution.reason === "exact" && match) {
      row.personSlug = match.slug;
      if (candidate.evidence.length < 40) candidate.evidence.push({ fieldPath, origin: "lookup", excerpt: label, assessment: "inferred" });
    } else if (candidate.questions.length < 100) {
      candidate.questions.push({ fieldPath, reason: resolution.reason, alternatives: [...new Set(resolution.matches.map(match => match.slug))] });
    }
  }
}

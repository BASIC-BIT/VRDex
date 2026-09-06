// Name matching is deliberately separate from keyword/genre search.
const SUBSTITUTIONS: Record<string, string> = {
  "0": "o", "1": "il", "3": "e", "4": "a", "5": "s", "7": "t",
};

export function normalizeProfileName(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}

// Folding i/l together is only for candidate retrieval. Verification below
// requires a real digit on one side and never equates ordinary i and l.
function candidateName(value: string): string {
  return normalizeProfileName(value).replace(/[013457il]/g, (character) =>
    character === "i" || character === "l" || character === "1"
      ? "i" : SUBSTITUTIONS[character][0]);
}

const encoder = new TextEncoder();

function indexPrefix(value: string): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    bytes += encoder.encode(character).length;
    // Leave one byte for the literal/stylized namespace prefix.
    if (bytes > 31) break;
    result += character;
  }
  return result;
}

export function profileNameSearchQuery(query: string, kind: "literal" | "styled"): string | undefined {
  const normalized = kind === "literal" ? normalizeProfileName(query) : candidateName(query);
  return [...normalized].length >= 3
    ? `${kind === "literal" ? "l" : "s"}${indexPrefix(normalized)}` : undefined;
}

export function profileNameSearchFields(values: string[]) {
  // Bound index size even for imported records with unusually many aliases.
  // Identity and slug are supplied first; the budget is shared with aliases.
  let remaining = 512;
  // Keep full names for verification/ranking, independently of retrieval budget.
  const searchNames = [...new Set(values.map(normalizeProfileName).filter(Boolean))];
  const suffixes = new Set<string>();
  let indexBytes = 0;
  for (const name of searchNames) {
    const characters = [...name].slice(0, Math.min(120, remaining));
    const styledCharacters = [...candidateName(name)].slice(0, characters.length);
    remaining -= characters.length;
    for (let offset = 0; offset <= characters.length - 3; offset += 1) {
      for (const term of [
        `l${indexPrefix(characters.slice(offset).join(""))}`,
        `s${indexPrefix(styledCharacters.slice(offset).join(""))}`,
      ]) {
        if (suffixes.has(term)) continue;
        const termBytes = encoder.encode(term).length + (suffixes.size > 0 ? 1 : 0);
        if (indexBytes + termBytes > 16_000) {
          return { searchNames, nameSearchText: [...suffixes].join(" ") };
        }
        suffixes.add(term);
        indexBytes += termBytes;
      }
    }
    if (remaining === 0) break;
  }
  return { searchNames, nameSearchText: [...suffixes].join(" ") };
}

function styledIndex(name: string, query: string): number {
  const haystack = [...name];
  const needle = [...query];
  // Numeric-only lookups stay numeric, e.g. 101 must not find lol.
  const allowSubstitutions = /\p{L}/u.test(query);
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (needle.every((character, index) => {
      const other = haystack[offset + index];
      return character === other || (allowSubstitutions && (
        SUBSTITUTIONS[character]?.includes(other) || SUBSTITUTIONS[other]?.includes(character)
      ));
    })) return offset;
  }
  return -1;
}

export function profileNameMatchRank(names: string[], query: string): number {
  const needle = normalizeProfileName(query);
  if (!needle) return 0;
  const partial = [...needle].length >= 3;
  let rank = 0;
  for (const value of names) {
    const name = normalizeProfileName(value);
    const literal = name.indexOf(needle);
    if (name === needle) rank = Math.max(rank, 6);
    else if (partial && literal >= 0) rank = Math.max(rank, literal === 0 ? 5 : 4);
    else if (partial) {
      const styled = styledIndex(name, needle);
      if (styled >= 0) rank = Math.max(rank, name.length === needle.length ? 3 : styled === 0 ? 2 : 1);
    }
  }
  return rank;
}

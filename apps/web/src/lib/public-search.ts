import type { PublicSearchResult as BackendPublicSearchResult } from "../../../../convex/_searchDocuments";

export type PublicSearchResult = BackendPublicSearchResult & { claimEntryPath?: string };
export type PublicSearchPerson = NonNullable<PublicSearchResult["person"]>;
export type PublicSearchGenre = PublicSearchPerson["genres"][number];

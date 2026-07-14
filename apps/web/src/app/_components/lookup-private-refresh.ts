export function shouldRefreshBulkPrivateLookup({
  bulkEntryCount,
  flagEnabled,
  lineCount,
  refreshAttempted,
}: {
  bulkEntryCount: number;
  flagEnabled: boolean;
  lineCount: number;
  refreshAttempted: boolean;
}): boolean {
  return bulkEntryCount > 0 && flagEnabled && lineCount > 0 && !refreshAttempted;
}

export function uniqueProfileIdentityItems(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return items.filter((item): item is string => {
    if (!item?.trim()) return false;
    const key = item.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

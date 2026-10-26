/** Shared diagnostics timing. The request allowance covers the worker's bounded
 * control request; receipt time alone must never make an old sample fresh.
 */
export const RESOURCE_INTERVAL_MS = 10_000;
export const RESOURCE_STALE_AFTER_MS = 30_000;
export const RESOURCE_REQUEST_ALLOWANCE_MS = 3_000;

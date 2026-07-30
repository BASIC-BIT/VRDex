/**
 * Inert while the auth-session matrix specs are skipped.
 *
 * This deleted the Convex Auth account those specs created, through
 * `DELETE /api/e2e/auth`. Clerk owns accounts now, that route is gone, and the
 * specs create nothing — so the call only produced a 404 and failed the job even
 * though every test was skipped.
 *
 * Restore alongside the specs in #226, against whatever seam the Clerk testing
 * flow needs. Kept rather than deleted so the Playwright config wiring and the
 * run-id contract stay intact.
 */
export default async function cleanupAuthSessionMatrixAccount() {
  return;
}

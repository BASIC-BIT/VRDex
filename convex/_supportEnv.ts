/**
 * Environment reads for the support intake, in one place.
 *
 * `_supportIntake.ts` and `_supportDigest.ts` each grew their own copy of this
 * three-line helper, and the intake mutations now need it too. A fourth would
 * have been three too many.
 */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}

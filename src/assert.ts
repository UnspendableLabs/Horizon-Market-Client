/** Throw when both optional params are set (server returns 400). */
export function assertMutuallyExclusive(
  a: unknown,
  b: unknown,
  aName: string,
  bName: string,
): void {
  if (a !== undefined && b !== undefined) {
    throw new Error(`${aName} and ${bName} are mutually exclusive`);
  }
}

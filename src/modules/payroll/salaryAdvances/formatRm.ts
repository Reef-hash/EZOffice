/** Ringgit with thousands separators — used where HR compares amounts side by side. */
export function formatRm(value: number): string {
  return `RM ${value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

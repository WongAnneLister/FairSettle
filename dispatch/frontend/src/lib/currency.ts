/**
 * Formats integer cents into formatted currency string.
 * e.g., 1250 -> "$12.50"
 */
export function formatCents(cents?: number | null, currency = '$'): string {
  if (cents === null || cents === undefined || isNaN(cents)) {
    return `${currency}0.00`;
  }
  const dollars = (cents / 100).toFixed(2);
  return `${currency}${dollars}`;
}

/**
 * Converts a decimal dollar string or number to integer cents.
 * e.g., "12.50" -> 1250
 */
export function dollarsToCents(dollars: string | number): number {
  const num = typeof dollars === 'string' ? parseFloat(dollars) : dollars;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

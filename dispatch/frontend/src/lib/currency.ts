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
 * Parses a dollar amount typed by a person into integer cents (F38).
 * Accepts digits with an optional point and one or two decimals, after trimming:
 * "14", "14.5", "14.50". Anything else (empty, "12.0012.00", "14.505", "-1",
 * "1,000", "$14", "1e3", ".5") is null, never a different amount.
 * Integer arithmetic only, no parseFloat.
 */
export function parseDollars(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

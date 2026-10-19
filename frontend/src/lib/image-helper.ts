export const DEFAULT_RESTAURANT_COVER =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80';

export const DEFAULT_DISH_PHOTO =
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80';

/**
 * Validates and normalizes image URLs for Next.js next/image.
 *
 * next/image strictly requires:
 * 1. An absolute URL starting with http:// or https:// or data:image/
 * 2. OR a relative URL starting with a leading slash "/"
 *
 * Any bare string like "x.png", empty string, or invalid value will crash next/image
 * with "Failed to parse src on next/image".
 */
export function getValidImageUrl(
  src: string | null | undefined,
  fallback: string = DEFAULT_RESTAURANT_COVER
): string {
  if (!src || typeof src !== 'string') {
    return fallback;
  }

  const trimmed = src.trim();
  if (!trimmed) {
    return fallback;
  }

  // If it's already an absolute URL or data URI, check basic validity
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/')
  ) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      return fallback;
    }
  }

  // If it starts with leading slash, it's a valid relative path from /public
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  // If it's a bare string like "x.png" or "sample.jpg" without leading slash:
  // If it matches known placeholder values that don't exist, return the high-quality fallback
  if (trimmed === 'x.png' || trimmed === 'null' || trimmed === 'undefined') {
    return fallback;
  }

  // Otherwise, prefix with "/" to satisfy next/image relative path specification
  return `/${trimmed}`;
}

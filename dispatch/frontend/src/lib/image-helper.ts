export const DEFAULT_RESTAURANT_COVER =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80';

export const DEFAULT_DISH_PHOTO =
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80';

export const FOOD_PHOTO_PRESETS: { keywords: string[]; url: string }[] = [
  {
    keywords: ['pizza', 'margherita', 'pepperoni', 'slice', 'crust'],
    url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['lemonade', 'drink', 'beverage', 'juice', 'soda', 'coke', 'tea', 'water', 'cocktail', 'shake'],
    url: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['burger', 'cheeseburger', 'sandwich', 'patty', 'bun'],
    url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['pasta', 'spaghetti', 'noodles', 'ramen', 'penne', 'fettuccine', 'lasagna'],
    url: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281084?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['fries', 'potato', 'chips', 'snack', 'onion rings'],
    url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['salad', 'green', 'healthy', 'bowl', 'vegetable', 'caesar'],
    url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['dessert', 'cake', 'sweet', 'ice cream', 'chocolate', 'donut', 'cookie', 'pie'],
    url: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['coffee', 'espresso', 'latte', 'cappuccino'],
    url: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=600&q=80',
  },
  {
    keywords: ['chicken', 'wing', 'steak', 'meat', 'ribs', 'bbq', 'beef'],
    url: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=600&q=80',
  },
];

export function getDishPhoto(
  dish?: { name?: string; photo?: string | null } | null
): string {
  if (
    dish?.photo &&
    typeof dish.photo === 'string' &&
    dish.photo.trim() &&
    dish.photo !== 'x.png' &&
    dish.photo !== 'null' &&
    dish.photo !== 'undefined'
  ) {
    return getValidImageUrl(dish.photo, DEFAULT_DISH_PHOTO);
  }
  // Whole words only (with an optional plural "s"): "steak" must not match "tea".
  const words = (dish?.name || '').toLowerCase().match(/[a-z]+/g) ?? [];
  const phrase = ` ${words.join(' ')} `;
  for (const preset of FOOD_PHOTO_PRESETS) {
    if (preset.keywords.some((kw) => phrase.includes(` ${kw} `) || phrase.includes(` ${kw}s `))) {
      return preset.url;
    }
  }
  return DEFAULT_DISH_PHOTO;
}

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

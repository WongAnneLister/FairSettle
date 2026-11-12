import { describe, expect, it } from 'vitest';
import { DEFAULT_DISH_PHOTO, FOOD_PHOTO_PRESETS, getDishPhoto } from './image-helper';

const presetFor = (keyword: string) =>
  FOOD_PHOTO_PRESETS.find((preset) => preset.keywords.includes(keyword))!.url;

describe('dish photo', () => {
  it('P1 keeps the dish photo when it has one', () => {
    expect(getDishPhoto({ name: 'Pizza', photo: 'https://example.com/p.jpg' })).toBe(
      'https://example.com/p.jpg'
    );
  });

  it('P2 picks a preset by whole word, plural allowed', () => {
    const rows: [string, string][] = [
      ['Margherita Pizza', presetFor('pizza')],
      ['Fresh Lemonade', presetFor('lemonade')],
      ['Ribeye Steak', presetFor('steak')],
      ['Watermelon Salad', presetFor('salad')],
      ['Chicken Wings', presetFor('chicken')],
      ['Onion Rings', presetFor('onion rings')],
    ];
    for (const [name, url] of rows) expect(getDishPhoto({ name, photo: null }), name).toBe(url);
  });

  it('P3 falls back to the default photo', () => {
    expect(getDishPhoto({ name: 'Pierogi', photo: null })).toBe(DEFAULT_DISH_PHOTO);
    expect(getDishPhoto(null)).toBe(DEFAULT_DISH_PHOTO);
  });
});

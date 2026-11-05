import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DishForm } from './dish-form';

const FORM_WITH_PHOTO: DishForm = {
  restaurantId: 3,
  name: ' Margherita Pizza ',
  priceDollars: '14.50',
  description: 'Tomato, mozzarella and basil',
  photo: ' https://example.com/margherita.jpg ',
  options: [{ name: 'Size', choices: [{ name: 'Large', extraDollars: '3.00' }] }],
};
const FORM_WITHOUT_PHOTO: DishForm = {
  ...FORM_WITH_PHOTO, name: 'Plain Focaccia', photo: '', options: [],
};

describe('dish form', () => {
  // Load the new helper inside each test so D9 can check the page before it exists.
  it('D1 full form', async () => {
    const { createDishInput } = await import('./dish-form');
    expect(createDishInput(FORM_WITH_PHOTO)).toStrictEqual({
      ok: true,
      input: {
        restaurantId: 3,
        name: 'Margherita Pizza',
        priceCents: 1450,
        description: 'Tomato, mozzarella and basil',
        photo: 'https://example.com/margherita.jpg',
        options: [{ name: 'Size', choices: [{ name: 'Large', extraCents: 300 }] }],
      },
    });
  });

  it('D2 no photo, no options', async () => {
    const { createDishInput } = await import('./dish-form');
    const result = createDishInput(FORM_WITHOUT_PHOTO);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(Object.keys(result.input)).toEqual([
      'restaurantId', 'name', 'priceCents', 'description',
    ]);
  });

  it('D3 appended price', async () => {
    const { createDishInput } = await import('./dish-form');
    expect(createDishInput({ ...FORM_WITH_PHOTO, priceDollars: '12.0014.50' }))
      .toStrictEqual({ ok: false, error: 'Enter the price in dollars, for example 14.50' });
  });

  it('D4 empty price', async () => {
    const { createDishInput } = await import('./dish-form');
    expect(createDishInput({ ...FORM_WITH_PHOTO, priceDollars: '' }))
      .toStrictEqual({ ok: false, error: 'Enter the price in dollars, for example 14.50' });
  });

  it('D5 zero price', async () => {
    const { createDishInput } = await import('./dish-form');
    expect(createDishInput({ ...FORM_WITH_PHOTO, priceDollars: '0.00' }))
      .toStrictEqual({ ok: false, error: 'The price must be more than $0.00' });
  });

  it('D6 short name', async () => {
    const { createDishInput } = await import('./dish-form');
    expect(createDishInput({ ...FORM_WITH_PHOTO, name: ' Taco ' })).toStrictEqual({
      ok: false, error: 'The dish name needs at least 5 characters',
    });
  });

  it('D7 description length', async () => {
    const { createDishInput } = await import('./dish-form');
    for (const description of ['Hot', 'x'.repeat(257)]) {
      expect(createDishInput({ ...FORM_WITH_PHOTO, description })).toStrictEqual({
        ok: false, error: 'The description needs 5 to 256 characters',
      });
    }
    expect(createDishInput({ ...FORM_WITH_PHOTO, description: 'x'.repeat(256) }).ok)
      .toBe(true);
  });

  it('D8 extra prices', async () => {
    const { createDishInput } = await import('./dish-form');
    const withExtra = (extraDollars: string): DishForm => ({
      ...FORM_WITH_PHOTO,
      options: [{ name: 'Size', choices: [{ name: 'Large', extraDollars }] }],
    });
    expect(createDishInput(withExtra('3.001.00'))).toStrictEqual({
      ok: false, error: 'Enter the extra price for "Large" in dollars, for example 1.50',
    });
    const result = createDishInput(withExtra('0.00'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.input.options![0].choices[0].extraCents).toBe(0);
  });

  it('D9 the menu page uses the helper', () => {
    const source = readFileSync(
      new URL('../app/owner/restaurants/[id]/menu/page.tsx', import.meta.url), 'utf8',
    );
    expect(source).toContain('createDishInput(');
    expect(source).not.toContain('dollarsToCents');
    expect(source).not.toContain("useState('12.00')");
    expect(source).not.toContain('photo-1546069901');
  });
});

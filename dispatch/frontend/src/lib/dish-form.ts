// The dispatch e2e imports this helper: no React, @/ aliases or other imports.
import { parseDollars } from './currency';

export interface DishChoiceForm {
  name: string;
  extraDollars: string;
}

export interface DishOptionForm {
  name: string;
  choices: DishChoiceForm[];
}

export interface DishForm {
  restaurantId: number;
  name: string;
  priceDollars: string;
  description: string;
  photo: string;
  options: DishOptionForm[];
}

/** The `input` variable of CREATE_DISH_MUTATION; keys match CreateDishInput (F38). */
export interface CreateDishVariables {
  restaurantId: number;
  name: string;
  priceCents: number;
  description: string;
  photo?: string;
  options?: { name: string; choices: { name: string; extraCents: number }[] }[];
}

export type DishFormResult =
  | { ok: true; input: CreateDishVariables }
  | { ok: false; error: string };

export function createDishInput(form: DishForm): DishFormResult {
  const name = form.name.trim();
  if (name.length < 5) {
    return { ok: false, error: 'The dish name needs at least 5 characters' };
  }

  const priceCents = parseDollars(form.priceDollars);
  if (priceCents === null) {
    return { ok: false, error: 'Enter the price in dollars, for example 14.50' };
  }
  if (priceCents === 0) {
    return { ok: false, error: 'The price must be more than $0.00' };
  }

  const description = form.description.trim();
  // The limits 5 and 256 mirror @Length on Dish in dish.entity.ts.
  if (description.length < 5 || description.length > 256) {
    return { ok: false, error: 'The description needs 5 to 256 characters' };
  }

  const options: NonNullable<CreateDishVariables['options']> = [];
  for (const option of form.options) {
    const choices: { name: string; extraCents: number }[] = [];
    for (const choice of option.choices) {
      const extraCents = parseDollars(choice.extraDollars);
      if (extraCents === null) {
        return {
          ok: false,
          error: `Enter the extra price for "${choice.name.trim()}" in dollars, for example 1.50`,
        };
      }
      choices.push({ name: choice.name.trim(), extraCents });
    }
    options.push({ name: option.name.trim(), choices });
  }

  const photo = form.photo.trim();
  const input: CreateDishVariables = {
    restaurantId: form.restaurantId,
    name,
    priceCents,
    description,
  };
  if (photo) input.photo = photo;
  if (form.options.length > 0) input.options = options;
  return { ok: true, input };
}

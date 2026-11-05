import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';

import {CreateDishInput} from './create-dish.dto';
import {EditDishInput} from './edit-dish.dto';

describe('dish inputs', () => {
  const base = {
    restaurantId: 1,
    name: 'Margherita Pizza',
    priceCents: 1450,
    description: 'Tomato and basil',
  };

  it('V1 accepts a dish without a photo', async () => {
    const errors = await validate(plainToInstance(CreateDishInput, base));
    expect(errors.map(error => error.property)).toEqual([]);
  });

  it('V2 accepts a photo string', async () => {
    const errors = await validate(
      plainToInstance(CreateDishInput, {...base, photo: 'https://example.com/m.jpg'}),
    );
    expect(errors.map(error => error.property)).toEqual([]);
  });

  it('V3 requires a create photo to be a string', async () => {
    const errors = await validate(plainToInstance(CreateDishInput, {...base, photo: 123}));
    expect(errors.map(error => error.property)).toEqual(['photo']);
  });

  it('V4 accepts an edit with only a photo or without a photo', async () => {
    const withPhoto = await validate(
      plainToInstance(EditDishInput, {dishId: 1, photo: 'https://example.com/n.jpg'}),
    );
    expect(withPhoto.map(error => error.property)).toEqual([]);
    const withoutPhoto = await validate(plainToInstance(EditDishInput, {dishId: 1}));
    expect(withoutPhoto.map(error => error.property)).toEqual([]);
  });

  it('V5 requires an edit photo to be a string', async () => {
    const errors = await validate(plainToInstance(EditDishInput, {dishId: 1, photo: 5}));
    expect(errors.map(error => error.property)).toEqual(['photo']);
  });
});

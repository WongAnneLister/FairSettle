import {ConfigService} from '@nestjs/config';
import {Response} from 'express';

import {schema} from '../config/schema-validation';
import {storefrontReturnUrl} from './checkout-return';
import {CheckoutReturnController} from './checkout-return.controller';

it('builds the storefront return URL', () => {
  expect(storefrontReturnUrl('http://localhost:3001', 'approved')).toBe(
    'http://localhost:3001/checkout/return?result=approved',
  );
  expect(storefrontReturnUrl('https://shop.example.com/', 'canceled')).toBe(
    'https://shop.example.com/checkout/return?result=canceled',
  );
  expect(storefrontReturnUrl('http://h:3001/shop', 'approved')).toBe(
    'http://h:3001/checkout/return?result=approved',
  );
});

it('redirects PayPal returns only when checkout is enabled', () => {
  const res = {status: jest.fn().mockReturnThis(), json: jest.fn(), redirect: jest.fn()};
  const response = res as unknown as Response;
  const controller = new CheckoutReturnController(
    new ConfigService({LEDGER_CHECKOUT: 'enabled', STOREFRONT_URL: 'http://storefront.test:3001'}),
  );
  controller.success(response);
  expect(res.redirect).toHaveBeenLastCalledWith(
    302,
    'http://storefront.test:3001/checkout/return?result=approved',
  );
  controller.cancel(response);
  expect(res.redirect).toHaveBeenLastCalledWith(
    302,
    'http://storefront.test:3001/checkout/return?result=canceled',
  );
  new CheckoutReturnController(new ConfigService({LEDGER_CHECKOUT: 'enabled'})).success(response);
  expect(res.redirect).toHaveBeenLastCalledWith(
    302,
    'http://localhost:3001/checkout/return?result=approved',
  );
  res.redirect.mockClear();
  new CheckoutReturnController(new ConfigService({LEDGER_CHECKOUT: 'disabled'})).success(response);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({error: 'not found'});
  expect(res.redirect).not.toHaveBeenCalled();
});

it('validates STOREFRONT_URL', () => {
  const base = {
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_PORT: 55432,
    DB_USER: 'adminer',
    DB_PASSWORD: 'secret123',
    DB_NAME: 'food_delivery_test',
    SECRET_KEY: 'test-secret',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 56380,
    FULFILLMENT_SIGNING_SECRET: 'mock-secret',
  };
  expect(schema.validate(base).value.STOREFRONT_URL).toBe('http://localhost:3001');
  expect(
    schema.validate({...base, STOREFRONT_URL: 'https://shop.example.com'}).error,
  ).toBeUndefined();
  for (const value of ['ftp://shop.example.com', 'not a url']) {
    expect(schema.validate({...base, STOREFRONT_URL: value}).error).toBeDefined();
  }
});

import {ConfigService} from '@nestjs/config';
import {Reflector} from '@nestjs/core';
import {ExecutionContextHost} from '@nestjs/core/helpers/execution-context-host';
import {schema} from '../config/schema-validation';
import {JwtService} from '../jwt/jwt.service';
import {UsersService} from '../users/users.service';
import {AuthGuard} from './auth.guard';
import {SERVICE_READABLE, serviceTokenMatches} from './service-token';

describe('service token', () => {
  it('serviceTokenMatches compares tokens', () => {
    const configured = 's'.repeat(40);
    for (const given of [
      configured,
      's'.repeat(39),
      's'.repeat(41),
      'x'.repeat(40),
      '',
      undefined,
      42,
    ]) {
      expect(serviceTokenMatches(configured, given)).toBe(given === configured);
    }
  });

  it('serviceTokenMatches refuses when unconfigured', () => {
    for (const configured of [undefined, '']) {
      expect(serviceTokenMatches(configured, 's'.repeat(40))).toBe(false);
    }
  });

  it('AGENT_SERVICE_TOKEN is optional and at least 32 characters', () => {
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
    expect(schema.validate(base).error).toBeUndefined();
    expect(schema.validate({...base, AGENT_SERVICE_TOKEN: 's'.repeat(32)}).error).toBeUndefined();
    expect(schema.validate({...base, AGENT_SERVICE_TOKEN: 's'.repeat(31)}).error).toBeDefined();
  });

  it('the guard refuses a service token when none is configured', async () => {
    const reflector = {
      get: (key: string) => (key === 'roles' ? ['Any'] : key === SERVICE_READABLE),
    };
    const jwtService = {verify: jest.fn()};
    const config = {get: jest.fn().mockReturnValue(undefined)};
    const guard = new AuthGuard(
      reflector as unknown as Reflector,
      jwtService as unknown as JwtService,
      {} as UsersService,
      config as unknown as ConfigService,
    );
    const gqlContext = {serviceToken: 's'.repeat(40), caller: undefined};
    const context = new ExecutionContextHost([{}, {}, gqlContext, {}]);
    context.setType('graphql');
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(jwtService.verify).not.toHaveBeenCalled();
    config.get.mockReturnValue('s'.repeat(40));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(gqlContext.caller).toEqual({kind: 'service'});
    expect(jwtService.verify).not.toHaveBeenCalled();
  });
});

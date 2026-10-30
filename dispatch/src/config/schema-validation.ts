import * as Joi from 'joi';

export const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .required(),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  SECRET_KEY: Joi.string().required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().required(),
  FULFILLMENT_SIGNING_SECRET: Joi.string().required(),
  // Agent read-only service token for getOrder and orderTimeline (F19); unset disables access.
  AGENT_SERVICE_TOKEN: Joi.string().min(32),
  OUTBOX_POLLING: Joi.string().valid('enabled', 'disabled').default('enabled'),
  LEDGER_CHECKOUT: Joi.string().valid('enabled', 'disabled').default('disabled'),
  LEDGER_BASE_URL: Joi.string()
    .uri()
    .when('LEDGER_CHECKOUT', {is: 'enabled', then: Joi.required()}),
  LEDGER_APP_TOKEN: Joi.string().when('LEDGER_CHECKOUT', {is: 'enabled', then: Joi.required()}),
  LEDGER_CHECKOUT_SUCCESS_URL: Joi.string()
    .uri({scheme: ['https']})
    .when('LEDGER_CHECKOUT', {is: 'enabled', then: Joi.required()}),
  LEDGER_CHECKOUT_CANCEL_URL: Joi.string()
    .uri({scheme: ['https']})
    .when('LEDGER_CHECKOUT', {is: 'enabled', then: Joi.required()}),
  LEDGER_NOTIFICATION_SECRET: Joi.string()
    .min(32)
    .when('LEDGER_CHECKOUT', {is: 'enabled', then: Joi.required()}),
  LEDGER_TIMEOUT_MS: Joi.number().default(10000),
  // Storefront origin that PayPal's return is redirected to (F33).
  STOREFRONT_URL: Joi.string()
    .uri({scheme: ['http', 'https']})
    .default('http://localhost:3001'),
  MAIL_HOST: Joi.string(),
  MAIL_PORT: Joi.number(),
  MAIL_USER: Joi.string(),
  MAIL_PASSWORD: Joi.string(),
});

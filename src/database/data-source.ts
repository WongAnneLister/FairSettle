import {config as loadEnv} from 'dotenv';
import {DataSource} from 'typeorm';

import {entities} from './entities';
import {environments} from '../config/environments';

/**
 * DataSource used by the TypeORM CLI (migration:generate / :run / :revert).
 *
 * The Nest application builds its own connection in DatabaseModule via
 * ConfigService; the CLI runs outside Nest, so it loads the same .env file
 * directly. Both import `entities` from one place so the two can never drift.
 */
loadEnv({path: environments[process.env.NODE_ENV] ?? '.env.dev'});

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities,
  // Resolves against src/ under ts-node and dist/ after a build.
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});

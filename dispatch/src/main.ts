import {AppModule} from './app.module';
import {NestFactory} from '@nestjs/core';
import {ValidationPipe} from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {rawBody: true});
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(4000);
}
bootstrap();

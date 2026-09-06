import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Global prefix /api/v1 as specified in Phase 1 requirements
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  setupSwagger(app);

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  console.log(`[STM-NestJS] Listening on http://localhost:${port}/api/v1`);
  console.log(`[STM-NestJS] Swagger UI at http://localhost:${port}/docs`);
}
bootstrap();

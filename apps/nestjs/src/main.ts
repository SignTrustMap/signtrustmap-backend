import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { setupSwagger } from "./config/swagger.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(json({ limit: "10mb" }));
  app.use(urlencoded({ extended: true, limit: "10mb" }));

  const configService = app.get(ConfigService);

  // Global prefix /api/v1 as specified in Phase 1 requirements
  app.setGlobalPrefix("api/v1");

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

  // Redirect legacy Swagger URLs to /docs
  app.use(['/swagger-ui', '/swagger-ui/index.html'], (_req: any, res: any) => {
    res.redirect(301, '/docs');
  });

  const port = configService.get<number>("PORT", 3000);
  await app.listen(port);
  console.log(`[STM-NestJS] Listening on http://localhost:${port}/api/v1`);
  console.log(`[STM-NestJS] Swagger UI at http://localhost:${port}/docs`);
}
bootstrap();

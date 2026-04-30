import { NestFactory } from "@nestjs/core";

async function bootstrap() {
  await NestFactory.create({});
}

void bootstrap();

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ProviderErrorFilter } from "./providers/provider-error.filter.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ProviderErrorFilter());
  // B-7: apps/web is the first browser client of this API and runs on a
  // different origin/port in dev (Next.js default 3000 vs this API's own
  // default 3000 — WEB_ORIGIN lets either be reconfigured without a code
  // change). No credentials/cookies are involved (auth is the placeholder
  // x-user-id header, not a cookie), so this is a plain allow-list, not a
  // wildcard.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3001" });
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();

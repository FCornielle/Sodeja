import { Module } from "@nestjs/common";
import { ProvidersModule } from "./providers/providers.module.js";

/**
 * Deliberately the only module here. apps/api/README.md documents 13
 * eventual NestJS modules (auth, projects, geo, ...); each lands with the
 * backlog item that needs it. B-3's scope is exactly the providers proxy.
 */
@Module({
  imports: [ProvidersModule],
})
export class AppModule {}

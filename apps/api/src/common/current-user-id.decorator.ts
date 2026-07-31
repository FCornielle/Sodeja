import { BadRequestException, createParamDecorator, type ExecutionContext } from "@nestjs/common";

/**
 * TEMPORARY AUTH PLACEHOLDER — no `auth` NestJS module exists yet
 * (apps/api/README.md's module table lists it as its own, unbuilt, backlog
 * item: Supabase JWT verification). Every module built so far follows the
 * same pattern of not inventing that infrastructure early: userId is read
 * directly off an `x-user-id` request header, which a real auth
 * guard/middleware will eventually populate only after verifying a Supabase
 * JWT's `sub` claim.
 *
 * This decorator is NOT an authorization boundary and must never be treated
 * as one — it only decides which user's RLS-scoped DB session
 * (`@sodeja/db`'s `withUserSession`) to open. Row-level security is the
 * actual enforcement layer (SODEJA_ARCHITECTURE.md "Auth & data access");
 * this header is trusted exactly as far as the request already reached this
 * process, same as any other pre-auth-module SODEJA endpoint.
 */
export const CurrentUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const header = request.headers["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new BadRequestException(
      "x-user-id header is required (no auth module yet — see CurrentUserId decorator)",
    );
  }
  return userId;
});

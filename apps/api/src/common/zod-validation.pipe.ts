import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodType, ZodTypeDef } from "zod";

/**
 * DTO validation via `@sodeja/schemas` Zod schemas (apps/api/README.md,
 * CLAUDE.md "no business calculation in a controller or service" — this is
 * the input-boundary counterpart: validate at the edge, never trust a
 * request body past the controller). Generic over the schema's inferred
 * output type, so `@Body(new ZodValidationPipe(SomeRequestSchema))` gives the
 * handler a fully-typed, already-validated value. The schema parameter's
 * Input is deliberately left `unknown` (rather than defaulting to `T`) so a
 * schema whose input and output shapes differ — e.g. B-7's
 * `FootprintBboxQuerySchema`, which parses a raw `?bbox=` query string into a
 * `{minLon,minLat,maxLon,maxLat}` object — still type-checks here.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.flatten(),
      });
    }
    return result.data;
  }
}

import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * DTO validation via `@sodeja/schemas` Zod schemas (apps/api/README.md,
 * CLAUDE.md "no business calculation in a controller or service" — this is
 * the input-boundary counterpart: validate at the edge, never trust a
 * request body past the controller). Generic over the schema's inferred
 * type, so `@Body(new ZodValidationPipe(SomeRequestSchema))` gives the
 * handler a fully-typed, already-validated value.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

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

import { ZodSchema, z } from "zod";

export function ZodValidator<Schema extends ZodSchema>(
  schema: Schema
): (input: z.input<Schema>) => z.output<Schema> {
  return (input) => {
    return schema.parse(input);
  };
}

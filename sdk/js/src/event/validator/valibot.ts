import { BaseSchema, parse, Input } from "valibot";

export function ValibotValidator<T extends BaseSchema>(schema: T) {
  return (value: Input<T>) => {
    return parse(schema, value);
  };
}

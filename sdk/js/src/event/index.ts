// src/event/index.ts
type ParserZodEsque<TInput, TParsedInput> = {
  _input: TInput;
  _output: TParsedInput;
};

type ParserValibotEsque<TInput, TParsedInput> = {
  _types?: {
    input: TInput;
    output: TParsedInput;
  };
};

type ParserWithInputOutput<TInput, TParsedInput> =
  | ParserZodEsque<TInput, TParsedInput>
  | ParserValibotEsque<TInput, TParsedInput>;

type Parser = ParserWithInputOutput<any, any>;

type inferParser<TParser extends Parser> =
  TParser extends ParserWithInputOutput<infer $TIn, infer $TOut>
  ? {
    in: $TIn;
    out: $TOut;
  }
  : never;

export type Definition = {
  type: string;
  $input: unknown;
  $output: unknown;
  $metadata: unknown;
  $payload: unknown;
  create: (...args: any[]) => Promise<any>;
};

export function builder<
  Metadata extends
  | ((type: string, properties: any) => any)
  | Parameters<Validator>[0],
  Validator extends (schema: any) => (input: any) => any
>(input: { validator: Validator; metadata?: Metadata }) {
  const validator = input.validator;

  function event<Type extends string, Schema extends Parameters<Validator>[0]>(
    type: Type,
    schema: Schema
  ) {
    type MetadataOutput = Metadata extends (
      type: string,
      properties: any
    ) => any
      ? ReturnType<Metadata>
      : inferParser<Metadata extends Parser ? Metadata : never>["out"];

    type Payload = {
      type: Type;
      properties: Parsed["out"];
      metadata: MetadataOutput;
    };

    type Parsed = inferParser<Schema extends Parser ? Schema : never>;

    type Create = Metadata extends (type: string, properties: any) => any
      ? (properties: Parsed["in"]) => Promise<Payload>
      : (
        properties: Parsed["in"],
        metadata: inferParser<Metadata extends Parser ? Metadata : never>["in"]
      ) => Promise<Payload>;

    const validate = validator(schema);

    async function create(properties: any, metadata?: any): Promise<Payload> {
      try {
        const validatedProps = validate(properties);
        const computedMetadata = input.metadata
          ? typeof input.metadata === "function"
            ? input.metadata(type, properties)
            : input.metadata(metadata)
          : {};

        return {
          type,
          properties: validatedProps,
          metadata: computedMetadata,
        };
      } catch (error) {
        throw new Error(
          `Failed to create event "${type}": ${error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return {
      create: create as Create,
      type,
      $input: {} as Parsed["in"],
      $output: {} as Parsed["out"],
      $payload: {} as Payload,
      $metadata: {} as MetadataOutput,
    } satisfies Definition;
  }

  event.coerce = <Events extends Definition>(
    _events: Events | Events[],
    raw: any
  ): {
    [K in Events["type"]]: Extract<Events, { type: K }>["$payload"];
  }[Events["type"]] => {
    return raw;
  };

  return event;
}

export { builder as event };

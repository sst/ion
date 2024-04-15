import { Resource } from "sst";
import { Handler } from "aws-lambda";
import { Example } from "@aws-monorepo/core/example";

export const handler: Handler = async (event) => {
  console.dir(event);
  return {
    statusCode: 200,
    body: Example.hello(),
  };
};

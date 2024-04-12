import { Example } from "@aws-monorepo/core/example";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

const app = new Hono();

// TODO: Use a native function instead
app.get("/", async (c) => {
  console.log("calling Example.hello");
  return c.text(Example.hello());
});

export const handler = handle(app);

import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: {
    preset: "aws-lambda-streaming",
  },
});

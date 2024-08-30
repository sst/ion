/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-rust-function-url",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: { region: 'us-east-1' }
      },
    };
  },
  async run() {
    const api = new sst.aws.Function("api", {
      handler: "bootstrap",
      architecture: "x86_64",
      bundle: "target/lambda/api",
      runtime: 'provided.al2023',
      url: true,
    });
    return { function: api.url }
  }
});

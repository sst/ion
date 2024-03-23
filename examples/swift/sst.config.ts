/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "swift",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const swift = new sst.aws.Function("Swift", {
      runtime: "provided.al2023",
      architecture: process.arch === "arm64" ? "arm64" : "x86_64",
      bundle: ".build/lambda/app",
      handler: "bootstrap",
      url: true,
      streaming: false,
    });
    const router = new sst.aws.Router("SwiftRouter", {
      routes: {
        "/*": swift.url,
      },
      domain: "swift.dev.sst.dev",
    });
    return {
      url: router.url,
    };
  },
});

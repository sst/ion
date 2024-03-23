/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "node:child_process";

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
      bundle: build("app"),
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

function build(target: string) {
  execSync(`
    docker run \
      --rm \
      -v ./:/workspace \
      -w /workspace \
      swift:5.10-amazonlinux2 \
      bash -cl "swift build -c release --static-swift-stdlib"
  `);
  execSync(`
    mkdir -p .build/lambda/${target}
  `);
  execSync(`
    cp .build/release/${target} .build/lambda/${target}/bootstrap
  `);
  return `.build/lambda/${target}`;
}

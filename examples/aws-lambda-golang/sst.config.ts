/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-lambda-golang",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket", {
      access: "public",
    });
    const fn = new sst.aws.Function("Fn", {
      url: true,
      runtime: "golang",
      link: [bucket],
      handler: "cmd/example",
    });
    return {
      api: fn.url,
    };
  },
});

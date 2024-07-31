/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-import",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    new sst.aws.Bucket("MyBucket", {
      transform: {
        bucket(args, opts) {
          opts.import = "aws-import-my-bucket";
          args.bucket = "aws-import-my-bucket";
          args.forceDestroy = undefined;
        },
      },
    });
  },
});

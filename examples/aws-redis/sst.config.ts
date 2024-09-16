/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-redis",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", { nat: "managed" });
    const redis = new sst.aws.Redis("MyRedis", { vpc });
    return { vpc: vpc.id, redis: redis.host, port: redis.port };
  },
});

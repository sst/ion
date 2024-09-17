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
    const app = new sst.aws.Function("MyApp", {
      handler: "index.handler",
      url: true,
      vpc,
      timeout: "10 seconds",
      link: [redis],
    });
    return {
      vpc: vpc.id,
      app: app.url,
      host: redis.host,
      port: redis.port,
      username: redis.username,
      password: redis.password,
    };
  },
});

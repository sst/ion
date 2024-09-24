/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-rust-loco",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("LocoVpc");

    const database = new sst.aws.Postgres("LocoDatabase", { vpc });

    const redis = new sst.aws.Redis("LocoRedis", { vpc });

    const DATABASE_URL = $interpolate`postgres://${database.username}:${database.password.apply(encodeURIComponent)}@${database.host}:${database.port}/${database.database}`;
    const REDIS_URL = $interpolate`redis://${redis.username}:${redis.password.apply(encodeURIComponent)}@${redis.host}:${redis.port}`;

    const locoCluster = new sst.aws.Cluster("LocoCluster", { vpc });

    // external facing http service
    const locoServer = locoCluster.addService("LocoApp", {
      architecture: "x86_64",
      scaling: { min: 2, max: 4 },
      transform: {
        taskDefinition: (args) => {
          args.containerDefinitions = $jsonParse(
            args.containerDefinitions,
          ).apply((containerDefinitions) => {
            containerDefinitions[0].command = ["start"];

            return $jsonStringify(containerDefinitions);
          });
        },
      },
      public: {
        domain: "loco.mydomain.com",
        ports: [
          { listen: "80/http", forward: "5150/http" },
          { listen: "443/https", forward: "5150/http" },
        ],
      },
      environment: {
        DATABASE_URL,
        REDIS_URL,
      },
      link: [database, redis],
    });

    // add a worker that uses redis to process jobs off a queue
    locoCluster.addService("LocoWorker", {
      architecture: "x86_64",
      transform: {
        taskDefinition: (args) => {
          args.containerDefinitions = $jsonParse(
            args.containerDefinitions,
          ).apply((containerDefinitions) => {
            containerDefinitions[0].command = ["start", "--worker"];

            return $jsonStringify(containerDefinitions);
          });
        },
      },
      environment: {
        DATABASE_URL,
        REDIS_URL,
      },
      link: [database, redis],
    });

    return { endpoint: locoServer.url };
  },
});

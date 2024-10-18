/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "playground",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const ret: Record<string, $util.Output<string>> = {};

    const vpc = addVpc();
    const bucket = addBucket();
    //const efs = addEfs();
    //const email = addEmail();
    //const apiv1 = addApiV1();
    //const apiv2 = addApiV2();
    //const app = addFunction();
    //const service = addService();
    //const postgres = addPostgres();
    //const redis = addRedis();
    //const cron = addCron();

    return ret;

    function addVpc() {
      return new sst.aws.Vpc("MyVpc");
    }

    function addBucket() {
      const bucket = new sst.aws.Bucket("MyBucket");
      ret.bucket = bucket.name;
      return bucket;
    }

    function addEfs() {
      const efs = new sst.aws.Efs("MyEfs", { vpc });
      ret.efs = efs.id;
      ret.efsAccessPoint = efs.nodes.accessPoint.id;

      const app = new sst.aws.Function("MyEfsApp", {
        handler: "functions/efs/index.handler",
        volume: { efs },
        url: true,
        vpc,
      });
      ret.efsApp = app.url;

      return efs;
    }

    function addEmail() {
      const topic = new sst.aws.SnsTopic("MyTopic");
      topic.subscribe("functions/email/index.notification");

      const email = new sst.aws.Email("MyEmail", {
        sender: "wangfanjie@gmail.com",
        events: [
          {
            name: "notif",
            types: ["delivery"],
            topic: topic.arn,
          },
        ],
      });

      const sender = new sst.aws.Function("MyApi", {
        handler: "functions/email/index.sender",
        link: [email],
        url: true,
      });

      ret.emailSend = sender.url;
      ret.email = email.sender;
      ret.emailConfig = email.configSet;
      return ret;
    }

    function addCron() {
      const cron = new sst.aws.Cron("MyCron", {
        schedule: "rate(1 minute)",
        job: {
          handler: "functions/handler-example/index.handler",
          link: [bucket],
        },
      });
      ret.cron = cron.nodes.job.name;
      return cron;
    }

    function addApiV1() {
      const api = new sst.aws.ApiGatewayV1("MyApiV1");
      api.route("GET /", {
        handler: "functions/apiv2/index.handler",
        link: [bucket],
      });
      api.deploy();
      return api;
    }

    function addApiV2() {
      const api = new sst.aws.ApiGatewayV2("MyApiV2", {
        link: [bucket],
      });
      api.route("GET /", {
        handler: "functions/apiv2/index.handler",
      });
      return api;
    }

    function addFunction() {
      const app = new sst.aws.Function("MyApp", {
        handler: "functions/handler-example/index.handler",
        link: [bucket],
        url: true,
      });
      ret.app = app.url;
      return app;
    }

    function addService() {
      const cluster = new sst.aws.Cluster("MyCluster", { vpc });
      const service = cluster.addService("MyService", {
        public: {
          ports: [{ listen: "80/http" }],
        },
        image: {
          context: "cluster",
        },
        link: [bucket],
      });
      ret.service = service.url;
      return service;
    }

    function addPostgres() {
      const postgres = new sst.aws.Postgres("MyPostgres", {
        vpc,
      });
      ret.pgHost = postgres.host;
      ret.pgPort = $interpolate`postgres.port`;
      ret.pgUsername = postgres.username;
      ret.pgPassword = postgres.password;
      return postgres;
    }

    function addRedis() {
      const redis = new sst.aws.Redis("MyRedis", { vpc });
      const app = new sst.aws.Function("MyRedisApp", {
        handler: "functions/redis/index.handler",
        url: true,
        vpc,
        link: [redis],
      });
      return redis;
    }
  },
});

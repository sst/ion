/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-cluster",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("MyBucket", {
      public: true,
    });

    const vpc = new sst.aws.Vpc("MyVpc", { bastion: true });

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });
    const service = cluster.addService("MyService", {
      public: {
        ports: [{ listen: "80/http" }],
      },
      dev: {
        command: "node --watch index.mjs",
      },
      link: [bucket],
    });

    return {
      service: service.service,
      bastionCommand: $interpolate`aws ssm start-session --target ${vpc.bastion}`,
      ecsExecCommand: $interpolate`aws ecs execute-command --cluster ${cluster.nodes.cluster.name} --task $TASK_ID --container MyService --interactive --command "/bin/sh"`,
    };
  },
});

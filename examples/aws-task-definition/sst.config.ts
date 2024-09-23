/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "aws-task-definition",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
      const vpc = new sst.aws.Vpc("MyVpc", {
        
    });
    const cluster = new sst.aws.Cluster("MyCluster", {
      vpc,
    });

    cluster.addTaskDefinition("MyTaskDefinition", {});
  },
});

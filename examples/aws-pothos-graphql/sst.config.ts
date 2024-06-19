/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-pothos-graphql",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const pothos = new sst.aws.Function("PothosGraphql", {
      url: true,
      handler: "index.handler",
    });

    return {
      api: pothos.url,
    };
  },
});

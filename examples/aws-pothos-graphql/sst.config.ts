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
      handler: "pothos/graphql.handler",
    });

    const client = new sst.aws.Function("Client", {
      url: true,
      link: [pothos],
      handler: "client.handler",
    });

    return {
      api: pothos.url,
      client: client.url,
    };
  },
});

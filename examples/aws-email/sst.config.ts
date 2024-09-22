/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-email",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const topic = new sst.aws.SnsTopic("MyTopic");

    const email = new sst.aws.Email("MyEmail", {
      sender: "email@example.com",
      publishers: {
        Bounce: topic,
      },
    });

    const api = new sst.aws.Function("MyApi", {
      handler: "sender.handler",
      link: [email],
      url: true,
    });

    return {
      url: api.url,
    };
  },
});

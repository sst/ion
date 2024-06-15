/// <reference path="./.sst/platform/config.d.ts" />

import pulumi from "@pulumi/pulumi";

/**
 * ## Subscribe to queues
 *
 * Create an SQS queue, subscribe to it, and publish to it from a function.
 */
export default $config({
  app(input) {
    return {
      name: "aws-queue",
      home: "aws",
      removal: input.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const dlQueue = new sst.aws.Queue("MyDLQueue")
    const queue = new sst.aws.Queue("MyQueue", {
      transform: {
        queue:
            {
              redrivePolicy: pulumi.jsonStringify({
                deadLetterTargetArn: dlQueue.arn,
                maxReceiveCount: 5
              }),
            }
      }
    });
    queue.subscribe("subscriber.handler");

    const app = new sst.aws.Function("MyApp", {
      handler: "publisher.handler",
      link: [queue],
      url: true,
    });

    return {
      app: app.url,
      queue: queue.url,
    };
  },
});

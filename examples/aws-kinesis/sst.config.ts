/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## Kinesis streams
 *
 * Create a Kinesis stream, and subscribe to it with a function.
 */
export default $config({
  app(input) {
    return {
      name: "aws-kinesis",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const stream = new sst.aws.Kinesis("MyStream");
    // This lambda will handle all kind of events
    stream.subscribe("subscriber.handler");
    // This lambda will handle all events that contains { "type": "filter" }
    stream.subscribe(
      {
        handler: "subscriber-with-filter.handler",
      },
      {
        filters: [
          {
            data: {
              type: ["filter"],
            },
          },
        ],
      }
    );

    const app = new sst.aws.Function("MyApp", {
      handler: "publisher.handler",
      link: [stream],
      url: true,
    });

    return {
      app: app.url,
      stream: stream.name,
      streamArn: stream.arn,
    };
  },
});

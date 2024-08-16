/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## Bucket topic notifications
 *
 * Create an S3 bucket and subscribe to its events with an SNS topic.
 */
export default $config({
  app(input) {
    return {
      name: "aws-bucket-topic-subscriber",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
    };
  },
  async run() {
    const topic = new sst.aws.SnsTopic("MyTopic");
    topic.subscribe("subscriber.handler");

    const bucket = new sst.aws.Bucket("MyBucket");
    bucket.subscribeTopic(topic.arn, {
      events: ["s3:ObjectCreated:*"],
    });

    return {
      bucket: bucket.name,
      topic: topic.name,
    };
  },
});

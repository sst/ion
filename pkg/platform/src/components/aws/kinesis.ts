import * as aws from "@pulumi/aws";

import { ComponentResourceOptions, Output, all } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component.js";
import { Input } from "../input.js";
import { Link } from "../link.js";
import { hashStringToPrettyString, sanitizeToPascalCase } from "../naming.js";
import { FunctionArgs } from "./function.js";
import { KinesisLambdaSubscriber } from "./kinesis-lambda-subscriber.js";

export interface KinesisArgs {
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Kinesis stream resource.
     */
    stream?: Transform<aws.kinesis.StreamArgs>;
  };
}

export interface KinesisLambdaSubscriberArgs {
  /**
   * Filter the events that'll be processed by the `subscribers` functions.
   *
   * :::tip
   * You can pass in up to 5 different filters.
   * :::
   *
   * You can pass in up to 5 different filter policies. These will logically ORed together. Meaning that if any single policy matches, the record will be processed. Learn more about the [filter rule syntax](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html#filtering-syntax).
   *
   * @example
   * For example, if you Stream contains events in this JSON format.
   * ```js
   * {
   *    "kinesis": {
   *        "kinesisSchemaVersion": "1.0",
   *        "partitionKey": "1",
   *        "sequenceNumber": "49590338271490256608559692538361571095921575989136588898",
   *        "data": "eyJSZWNvcmROdW1iZXIiOiAiMDAwMSIsICJUaW1lU3RhbXAiOiAieXl5eS1tbS1kZFRoaDptbTpzcyIsICJSZXF1ZXN0Q29kZSI6ICJBQUFBIn0=",
   *        "approximateArrivalTimestamp": 1545084650.987
   *     },
   *    "eventSource": "aws:kinesis",
   *    "eventVersion": "1.0",
   *    "eventID": "shardId-000000000006:49590338271490256608559692538361571095921575989136588898",
   *    "eventName": "aws:kinesis:record",
   *   "invokeIdentityArn": "arn:aws:iam::123456789012:role/lambda-role",
   *    "awsRegion": "us-east-2",
   *    "eventSourceARN": "arn:aws:kinesis:us-east-2:123456789012:stream/lambda-stream"
   *}
   * ```
   *
   * To process only those events where the `kinesis.data` contains is `{ type: "filtered" }`.
   * ```js
   * {
   *    filters: [
   *      {
   *        data: {
   *          type: ["filter"],
   *        },
   *      },
   *    ],
   *  }
   * ```
   *
   */
  filters?: Input<Input<Record<string, any>>[]>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Lambda Event Source Mapping resource.
     */
    eventSourceMapping?: Transform<aws.lambda.EventSourceMappingArgs>;
  };
}

/**
 * The `Kinesis` component lets you add an [Amazon Kinesis Data Streams](https://docs.aws.amazon.com/streams/latest/dev/introduction.html) to your app.
 *
 * @example
 *
 * #### Create a stream
 *
 * ```ts
 * const stream = new sst.aws.Kinesis("MyStream");
 * ```
 *
 * #### Add a subscriber
 *
 * ```ts
 * stream.subscribe("src/subscriber.handler");
 * ```
 *
 * #### Link the stream to a resource
 *
 * You can link the stream to other resources, like a function or your Next.js app.
 *
 * ```ts {2}
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [stream]
 * });
 * ```
 *
 * Once linked, you can publish messages to the bus from your function code.
 *
 * ```ts title="app/page.tsx" {1,14,15}
 *import { Resource } from "sst";
 *import { KinesisClient, PutRecordCommand } from "@aws-sdk/client-kinesis";
 *
 *const client = new KinesisClient();
 *const blob = new Blob([JSON.stringify({ Hello: "World" })], {
 *  type: "application/json",
 *});
 *
 *const arrayBuffer = new Uint8Array(await blob.arrayBuffer());
 *
 *await client.send(
 *  new PutRecordCommand({
 *    Data: arrayBuffer,
 *    StreamARN: Resource.MyStream.stream.arn,
 *    StreamName: Resource.MyStream.stream.name,
 *    PartitionKey: "1",
 *  })
 *);
 * ```
 */
export class Kinesis
  extends Component
  implements Link.Linkable, Link.AWS.Linkable
{
  private constructorName: string;
  private stream: Output<aws.kinesis.Stream>;
  private subscribers: KinesisLambdaSubscriber[];

  constructor(
    name: string,
    args?: KinesisArgs,
    opts?: $util.ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const stream = $output(createStream());
    this.stream = stream;
    this.constructorName = name;

    this.subscribers = [];

    function createStream() {
      return new aws.kinesis.Stream(
        `${name}Stream`,
        transform(args?.transform?.stream, {
          shardCount: 1,
        }),
        { parent },
      );
    }
  }

  /**
   * Subscribe to this stream.
   *
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js
   * stream.subscribe("src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js
   * stream.subscribe("src/subscriber.handler", {
   *  filters: [
   *    {
   *      data: {
   *        type: ["filter"],
   *      },
   *    },
   *  ],
   *});
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js
   * stream.subscribe({
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public subscribe(
    subscriber: string | FunctionArgs,
    args?: KinesisLambdaSubscriberArgs,
    opts?: ComponentResourceOptions,
  ) {
    const lambdaSubscriber = Kinesis._subscribeFunction(
      this.constructorName,
      this.nodes.stream.arn,
      subscriber,
      args,
      opts,
    );
    lambdaSubscriber.apply((sub) => {
      this.subscribers.push(sub);
    });
  }

  private static _subscribeFunction(
    name: Input<string>,
    streamArn: Input<string>,
    subscriber: string | FunctionArgs,
    args: KinesisLambdaSubscriberArgs = {},
    opts?: ComponentResourceOptions,
  ) {
    return all([name, streamArn]).apply(([name, streamArn]) => {
      const prefix = sanitizeToPascalCase(name);

      const subscriberHandler =
        typeof subscriber === "string" ? subscriber : subscriber.handler;

      const suffix = sanitizeToPascalCase(
        hashStringToPrettyString(`${streamArn}${subscriberHandler}`, 6),
      );
      return new KinesisLambdaSubscriber(
        `${prefix}Subscriber${suffix}`,
        {
          stream: { arn: streamArn },
          subscriber,
          ...args,
        },
        opts,
      );
    });
  }

  public get name() {
    return this.stream.name;
  }

  public get arn() {
    return this.stream.arn;
  }

  public get nodes() {
    const self = this;
    return {
      get subscribers() {
        return self.subscribers;
      },
      get stream() {
        return self.stream;
      },
    };
  }

  /** @internal */
  getSSTLink() {
    return {
      properties: {
        name: this.stream.name,
        arn: this.stream.arn,
      },
    };
  }

  /** @internal */
  getSSTAWSPermissions() {
    return [
      {
        actions: ["kinesis:*"],
        resources: [this.nodes.stream.arn],
      },
    ];
  }
}

const __pulumiType = "sst:aws:Kinesis";
// @ts-expect-error
Kinesis.__pulumiType = __pulumiType;

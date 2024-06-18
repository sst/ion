import * as aws from "@pulumi/aws";
import { Output, output } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { Input } from "../input.js";
import { Function, FunctionArgs } from "./function.js";
import { KinesisLambdaSubscriberArgs } from "./kinesis.js";

export interface Args extends KinesisLambdaSubscriberArgs {
  /**
   * The stream to use.
   */
  stream: Input<{
    /**
     * The ARN of the stream.
     */
    arn: Input<string>;
  }>;
  /**
   * The subscriber function.
   */
  subscriber: Input<string | FunctionArgs>;
}

/**
 * The `KinesisLambdaSubscriber` component is internally used by the `Kinesis` component to
 * add consumer to [Amazon Kinesis](https://aws.amazon.com/kinesis/).
 *
 * :::caution
 * This component is not intended for public use.
 * :::
 *
 * You'll find this component returned by the `subscribe` method of the `Kinesis` component.
 */
export class KinesisLambdaSubscriber extends Component {
  private readonly fn: Output<Function>;
  private readonly eventSourceMapping: aws.lambda.EventSourceMapping;
  constructor(name: string, args: Args, opts?: $util.ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const stream = output(args.stream);
    const fn = createFunction();
    const eventSourceMapping = createEventSourceMapping();

    this.fn = fn;
    this.eventSourceMapping = eventSourceMapping;

    function createFunction() {
      return output(args.subscriber).apply((subscriber) => {
        return Function.fromDefinition(
          `${name}Function`,
          subscriber,
          {
            description: `Subscribed to ${name}`,
            permissions: [
              {
                actions: [
                  "kinesis:DescribeStream",
                  "kinesis:DescribeStreamSummary",
                  "kinesis:GetRecords",
                  "kinesis:GetShardIterator",
                  "kinesis:ListShards",
                  "kinesis:ListStreams",
                  "kinesis:SubscribeToShard",
                  "logs:CreateLogGroup",
                  "logs:CreateLogStream",
                  "logs:PutLogEvents",
                ],
                resources: [stream.arn],
              },
            ],
          },
          undefined,
          { parent: self },
        );
      });
    }

    function createEventSourceMapping() {
      return new aws.lambda.EventSourceMapping(
        `${name}EventSourceMapping`,
        transform(args.transform?.eventSourceMapping, {
          eventSourceArn: stream.arn,
          functionName: fn.name,
          startingPosition: "LATEST",
          filterCriteria: args.filters && {
            filters: output(args.filters).apply((filters) =>
              filters.map((filter) => ({
                pattern: JSON.stringify(filter),
              })),
            ),
          },
        }),
        { parent: self },
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Lambda function that'll be notified.
       */
      function: self.fn,
      /**
       * The Lambda event source mapping.
       */
      eventSourceMapping: self.eventSourceMapping,
    };
  }
}

const __pulumiType = "sst:aws:KinesisLambdaSubscriber";
// @ts-expect-error
KinesisLambdaSubscriber.__pulumiType = __pulumiType;

import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { Function, FunctionArgs } from "./function";
import { DynamoSubscriberArgs } from "./dynamo";
import { lambda } from "@pulumi/aws";

export interface Args extends DynamoSubscriberArgs {
  /**
   * The DynamoDB table to use.
   */
  dynamo: Input<{
    /**
     * The ARN of the stream.
     */
    streamArn: Input<string>;
  }>;
  /**
   * The subscriber function.
   */
  subscriber: Input<string | FunctionArgs>;
}

/**
 * The `DynamoLambdaSubscriber` component is internally used by the `Dynamo` component to
 * add stream subscriptions to [Amazon DynamoDB](https://aws.amazon.com/dynamodb/).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribe` method of the `Dynamo` component.
 */
export class DynamoLambdaSubscriber extends Component {
  private readonly fn: Output<Function>;
  private readonly eventSourceMapping: lambda.EventSourceMapping;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const dynamo = output(args.dynamo);
    const fn = createFunction();
    const eventSourceMapping = createEventSourceMapping();

    this.fn = fn;
    this.eventSourceMapping = eventSourceMapping;

    function createFunction() {
      return Function.fromDefinition(
        `${name}Function`,
        args.subscriber,
        {
          description: `Subscribed to ${name}`,
          permissions: [
            {
              actions: [
                "dynamodb:DescribeStream",
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
                "dynamodb:ListStreams",
              ],
              resources: [dynamo.streamArn],
            },
          ],
        },
        undefined,
        { parent: self },
      );
    }

    function createEventSourceMapping() {
      return new lambda.EventSourceMapping(
        `${name}EventSourceMapping`,
        transform(args.transform?.eventSourceMapping, {
          eventSourceArn: dynamo.streamArn,
          functionName: fn.name,
          filterCriteria: args.filters
            ? output(args.filters).apply((filters) => ({
              filters: filters.map((filter) => ({
                pattern: JSON.stringify(filter),
              })),
            }))
            : undefined,
          startingPosition: "LATEST",
        }),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Lambda function that'll be notified.
       */
      function: this.fn,
      /**
       * The Lambda event source mapping.
       */
      eventSourceMapping: this.eventSourceMapping,
    };
  }
}

const __pulumiType = "sst:aws:DynamoLambdaSubscriber";
// @ts-expect-error
DynamoLambdaSubscriber.__pulumiType = __pulumiType;

import { ComponentResourceOptions, Input, output } from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { SnsTopicSubscriberArgs } from "./sns-topic";
import { parseQueueArn } from "./helpers/arn";
import { iam, sns, sqs } from "@pulumi/aws";

export interface Args extends SnsTopicSubscriberArgs {
  /**
   * The SNS Topic to use.
   */
  topic: Input<{
    /**
     * The ARN of the SNS Topic.
     */
    arn: Input<string>;
  }>;
  /**
   * The ARN of the SQS Queue.
   */
  queue: Input<string>;
}

/**
 * The `SnsTopicQueueSubscriber` component is internally used by the `SnsTopic` component
 * to add subscriptions to your [Amazon SNS Topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribeQueue` method of the `SnsTopic` component.
 */
export class SnsTopicQueueSubscriber extends Component {
  private readonly policy: sqs.QueuePolicy;
  private readonly subscription: sns.TopicSubscription;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const queueArn = output(args.queue);
    const topic = output(args.topic);
    const policy = createPolicy();
    const subscription = createSubscription();

    this.policy = policy;
    this.subscription = subscription;

    function createPolicy() {
      return new sqs.QueuePolicy(`${name}Policy`, {
        queueUrl: queueArn.apply((arn) => parseQueueArn(arn).queueUrl),
        policy: iam.getPolicyDocumentOutput({
          statements: [
            {
              actions: ["sqs:SendMessage"],
              resources: [queueArn],
              principals: [
                {
                  type: "Service",
                  identifiers: ["sns.amazonaws.com"],
                },
              ],
              conditions: [
                {
                  test: "ArnEquals",
                  variable: "aws:SourceArn",
                  values: [topic.arn],
                },
              ],
            },
          ],
        }).json,
      });
    }

    function createSubscription() {
      return new sns.TopicSubscription(
        ...transform(
          args?.transform?.subscription,
          `${name}Subscription`,
          {
            topic: topic.arn,
            protocol: "sqs",
            endpoint: queueArn,
            filterPolicy: JSON.stringify(args.filter ?? {}),
          },
          {},
        ),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The SQS Queue policy.
       */
      policy: this.policy,
      /**
       * The SNS Topic subscription.
       */
      subscription: this.subscription,
    };
  }
}

const __pulumiType = "sst:aws:SnsTopicQueueSubscriber";
// @ts-expect-error
SnsTopicQueueSubscriber.__pulumiType = __pulumiType;

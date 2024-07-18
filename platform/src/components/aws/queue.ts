import {
  ComponentResourceOptions,
  all,
  output,
  jsonStringify,
} from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { FunctionArgs } from "./function";
import { VisibleError } from "../error";
import { hashStringToPrettyString, sanitizeToPascalCase } from "../naming";
import { parseQueueArn } from "./helpers/arn";
import { QueueLambdaSubscriber } from "./queue-lambda-subscriber";
import { AWSLinkable } from "./linkable";
import { lambda, sqs } from "@pulumi/aws";

export interface QueueArgs {
  /**
   * FIFO or _first-in-first-out_ queues are designed to guarantee that messages are processed exactly once and in the order that they are sent.
   *
   * :::caution
   * Changing a standard queue to a FIFO queue (or the other way around) will cause the queue to be destroyed and recreated.
   * :::
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   fifo: true
   * }
   * ```
   */
  fifo?: Input<boolean>;
  /**
   * Optionally add a dead-letter queue or DLQ for this queue.
   *
   * A dead-letter queue is used to store messages that can't be processed successfully by the
   * subscriber function after the `retry` limit is reached.
   *
   * This takes either the ARN of the dead-letter queue or an object to configure how the
   * dead-letter queue is used.
   *
   * @example
   * For example, here's how you can create a dead-letter queue and link it to the main queue.
   *
   * ```ts title="sst.config.ts" {4}
   * const deadLetterQueue = new sst.aws.Queue("MyDLQ");
   *
   * new sst.aws.Queue("MyQueue", {
   *   dlq: deadLetterQueue.arn,
   * });
   * ```
   *
   * By default, the main queue will retry processing the message 3 times before sending it to the dead-letter queue. You can customize this.
   *
   * ```ts title="sst.config.ts" {3}
   * new sst.aws.Queue("MyQueue", {
   *   dlq: {
   *     retry: 5,
   *     queue: deadLetterQueue.arn,
   *   }
   * });
   * ```
   */
  dlq?: Input<
    | string
    | {
      /**
       * The ARN of the dead-letter queue.
       */
      queue: Input<string>;
      /**
       * The number of times the main queue will retry the message before sending it to the dead-letter queue.
       * @default `3`
       */
      retry: Input<number>;
    }
  >;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the SQS Queue resource.
     */
    queue?: Transform<sqs.QueueArgs>;
  };
}

export interface QueueSubscriberArgs {
  /**
   * Filter the records that'll be processed by the `subscriber` function.
   *
   * :::tip
   * You can pass in up to 5 different filters.
   * :::
   *
   * You can pass in up to 5 different filter policies. These will logically ORed together. Meaning that if any single policy matches, the record will be processed. Learn more about the [filter rule syntax](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventfiltering.html#filtering-syntax).
   *
   * @example
   * For example, if you Queue contains records in this JSON format.
   * ```js
   * {
   *   RecordNumber: 0000,
   *   RequestCode: "AAAA",
   *   TimeStamp: "yyyy-mm-ddThh:mm:ss"
   * }
   * ```
   *
   * To process only those records where the `RequestCode` is `BBBB`.

   * ```js
   * {
   *   filters: [
   *     {
   *       body: {
   *         RequestCode: ["BBBB"]
   *       }
   *     }
   *   ]
   * }
   * ```
   *
   * And to process only those records where `RecordNumber` greater than `9999`.
   *
   * ```js
   * {
   *   filters: [
   *     {
   *       body: {
   *         RecordNumber: [{ numeric: [ ">", 9999 ] }]
   *       }
   *     }
   *   ]
   * }
   * ```
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
    eventSourceMapping?: Transform<lambda.EventSourceMappingArgs>;
  };
}

/**
 * The `Queue` component lets you add a serverless queue to your app. It uses [Amazon SQS](https://aws.amazon.com/sqs/).
 *
 * @example
 *
 * #### Create a queue
 *
 * ```ts title="sst.config.ts"
 * const queue = new sst.aws.Queue("MyQueue");
 * ```
 *
 * #### Make it a FIFO queue
 *
 * You can optionally make it a FIFO queue.
 *
 * ```ts {2} title="sst.config.ts"
 * new sst.aws.Queue("MyQueue", {
 *   fifo: true
 * });
 * ```
 *
 * #### Add a subscriber
 *
 * ```ts title="sst.config.ts"
 * queue.subscribe("src/subscriber.handler");
 * ```
 *
 * #### Link the queue to a resource
 *
 * You can link the queue to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [queue]
 * });
 * ```
 *
 * Once linked, you can send messages to the queue from your function code.
 *
 * ```ts title="app/page.tsx" {1,7}
 * import { Resource } from "sst";
 * import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
 *
 * const sqs = new SQSClient({});
 *
 * await sqs.send(new SendMessageCommand({
 *   QueueUrl: Resource.MyQueue.url,
 *   MessageBody: "Hello from Next.js!"
 * }));
 * ```
 */
export class Queue extends Component implements Link.Linkable, AWSLinkable {
  private constructorName: string;
  private queue: sqs.Queue;
  private isSubscribed: boolean = false;

  constructor(name: string, args?: QueueArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const fifo = normalizeFifo();
    const dlq = normalizeDlq();

    const queue = createQueue();

    this.constructorName = name;
    this.queue = queue;

    function normalizeFifo() {
      return output(args?.fifo).apply((v) => v ?? false);
    }

    function normalizeDlq() {
      if (args?.dlq === undefined) return;

      return output(args?.dlq).apply((v) =>
        typeof v === "string" ? { queue: v, retry: 3 } : v,
      );
    }

    function createQueue() {
      return new sqs.Queue(
        `${name}Queue`,
        transform(args?.transform?.queue, {
          fifoQueue: fifo,
          redrivePolicy:
            dlq &&
            jsonStringify({
              deadLetterTargetArn: dlq.queue,
              maxReceiveCount: dlq.retry,
            }),
        }),
        { parent },
      );
    }
  }

  /**
   * The ARN of the SQS Queue.
   */
  public get arn() {
    return this.queue.arn;
  }

  /**
   * The SQS Queue URL.
   */
  public get url() {
    return this.queue.url;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon SQS Queue.
       */
      queue: this.queue,
    };
  }

  /**
   * Subscribe to this queue.
   *
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js title="sst.config.ts"
   * queue.subscribe("src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * queue.subscribe("src/subscriber.handler", {
   *   filters: [
   *     {
   *       body: {
   *         RequestCode: ["BBBB"]
   *       }
   *     }
   *   ]
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * queue.subscribe({
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public subscribe(
    subscriber: string | FunctionArgs,
    args?: QueueSubscriberArgs,
    opts?: ComponentResourceOptions,
  ) {
    if (this.isSubscribed)
      throw new VisibleError(
        `Cannot subscribe to the "${this.constructorName}" queue multiple times. An SQS Queue can only have one subscriber.`,
      );
    this.isSubscribed = true;

    return Queue._subscribeFunction(
      this.constructorName,
      this.arn,
      subscriber,
      args,
      opts,
    );
  }

  /**
   * Subscribe to an SQS Queue that was not created in your app.
   *
   * @param queueArn The ARN of the SQS Queue to subscribe to.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing SQS Queue with the following ARN.
   *
   * ```js title="sst.config.ts"
   * const queueArn = "arn:aws:sqs:us-east-1:123456789012:MyQueue";
   * ```
   *
   * You can subscribe to it by passing in the ARN.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Queue.subscribe(queueArn, "src/subscriber.handler");
   * ```
   *
   * Add a filter to the subscription.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Queue.subscribe(queueArn, "src/subscriber.handler", {
   *   filters: [
   *     {
   *       body: {
   *         RequestCode: ["BBBB"]
   *       }
   *     }
   *   ]
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Queue.subscribe(queueArn, {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public static subscribe(
    queueArn: Input<string>,
    subscriber: string | FunctionArgs,
    args?: QueueSubscriberArgs,
    opts?: ComponentResourceOptions,
  ) {
    const queueName = output(queueArn).apply(
      (queueArn) => parseQueueArn(queueArn).queueName,
    );
    return this._subscribeFunction(queueName, queueArn, subscriber, args, opts);
  }

  private static _subscribeFunction(
    name: Input<string>,
    queueArn: Input<string>,
    subscriber: string | FunctionArgs,
    args: QueueSubscriberArgs = {},
    opts?: ComponentResourceOptions,
  ) {
    return all([name, queueArn]).apply(([name, queueArn]) => {
      const prefix = sanitizeToPascalCase(name);
      const suffix = sanitizeToPascalCase(
        hashStringToPrettyString(queueArn, 6),
      );

      return new QueueLambdaSubscriber(
        `${prefix}Subscriber${suffix}`,
        {
          queue: { arn: queueArn },
          subscriber,
          ...args,
        },
        opts,
      );
    });
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.url,
      },
    };
  }

  /** @internal */
  public getSSTAWSPermissions() {
    return [
      {
        actions: ["sqs:*"],
        resources: [this.arn],
      },
    ];
  }
}

const __pulumiType = "sst:aws:Queue";
// @ts-expect-error
Queue.__pulumiType = __pulumiType;

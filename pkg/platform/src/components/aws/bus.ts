import { ComponentResourceOptions, all, output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { FunctionArgs } from "./function";
import {
  hashStringToPrettyString,
  prefixName,
  sanitizeToPascalCase,
} from "../naming";
import { parseEventBusArn } from "./helpers/arn";
import { BusLambdaSubscriber } from "./bus-lambda-subscriber";
import { AWSLinkable } from "./linkable";
import { cloudwatch } from "@pulumi/aws";

export interface BusArgs {
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the EventBus resource.
     */
    bus?: Transform<cloudwatch.EventBusArgs>;
  };
}

export interface BusSubscriberArgs {
  /**
   * Filter the messages that'll be processed by the subscriber.
   *
   * If any single property in the pattern doesn't match
   * an attribute assigned to the message, then the pattern rejects the message.
   *
   *
   * :::tip
   * Learn more about [event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html).
   * :::
   *
   * @example
   * For example, if your EventBus message contains this in a JSON format.
   * ```js
   * {
   *   source: "my.source",
   *   detail: {
   *      price_usd: 210.75
   *   },
   *   "detail-type": "orderPlaced",
   * }
   * ```
   *
   * Then this pattern accepts the message.
   *
   * ```js
   * {
   *   pattern: {
   *     source: ["my.source", "my.source2"],
   *   }
   * }
   * ```
   */
  pattern?: Input<{
    /**
     * A list of "source" values to match against. "source" indicates where the event
     * originated.
     *
     * @example
     * ```js
     * {
     *   pattern: {
     *     source: "my.source"
     *   },
     * }
     * ```
     */
    source?: (string | any)[];
    /**
     * A JSON object of "detail" values to match against. "detail" contains the actual
     * data or information associated with the event.
     *
     * @example
     * ```js
     * {
     *   pattern: {
     *     price_usd: [{numeric: [">=", 100]}]
     *   },
     * }
     * ```
     */
    detail?: { [key: string]: any };
    /**
     * A list of "detail-type" values to match against. "detail-type" typically defines
     * the kind of event that is occurring.
     *
     * @example
     * ```js
     * {
     *   pattern: {
     *     detailType: ["orderPlaced"]
     *   },
     * }
     * ```
     */
    detailType?: (string | any)[];
  }>;
  /**
   * [Transform](/docs/components#transform) how this subscription creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the EventBus rule resource.
     */
    rule?: Transform<cloudwatch.EventRuleArgs>;
    /**
     * Transform the EventBus target resource.
     */
    target?: Transform<cloudwatch.EventTargetArgs>;
  };
}

/**
 * The `Bus` component lets you add an [Amazon EventBridge Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html) to your app.
 *
 * @example
 *
 * #### Create a bus
 *
 * ```ts
 * const bus = new sst.aws.Bus("MyBus");
 * ```
 *
 * #### Add a subscriber
 *
 * ```ts
 * bus.subscribe("src/subscriber.handler");
 * ```
 *
 * #### Link the bus to a resource
 *
 * You can link the bus to other resources, like a function or your Next.js app.
 *
 * ```ts
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [bus]
 * });
 * ```
 *
 * Once linked, you can publish messages to the bus from your function code.
 *
 * ```ts title="app/page.tsx" {1,7}
 * import { Resource } from "sst";
 * import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
 *
 * const eb = new EventBridgeClient({});
 *
 * await eb.send(new PutEventsCommand({
 *   Entries: [
 *     {
 *       EventBusName: Resource.MyBus.name,
 *       Source: "my.source",
 *       Detail: JSON.stringify({ foo: "bar" }),
 *     }
 *   ],
 * }));
 * ```
 */
export class Bus extends Component implements Link.Linkable, AWSLinkable {
  private constructorName: string;
  private bus: cloudwatch.EventBus;

  constructor(
    name: string,
    args: BusArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const bus = createBus();

    this.constructorName = name;
    this.bus = bus;

    function createBus() {
      return new cloudwatch.EventBus(
        `${name}Bus`,
        transform(args.transform?.bus, {
          name: prefixName(256, name),
        }),
        { parent },
      );
    }
  }

  /**
   * The name of the EventBus.
   */
  public get name() {
    return this.bus.name;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon EventBus resource.
       */
      bus: this.bus,
    };
  }

  /**
   * Subscribe to this EventBus.
   *
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js
   * bus.subscribe("src/subscriber.handler");
   * ```
   *
   * Add a pattern to the subscription.
   *
   * ```js
   * bus.subscribe("src/subscriber.handler", {
   *   pattern: {
   *     source: ["my.source", "my.source2"],
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js
   * bus.subscribe({
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public subscribe(
    subscriber: string | FunctionArgs,
    args: BusSubscriberArgs = {},
  ) {
    return Bus._subscribeFunction(
      this.nodes.bus.name,
      this.nodes.bus.arn,
      subscriber,
      args,
    );
  }

  /**
   * Subscribe to an EventBus that was not created in your app.
   *
   * @param busArn The ARN of the EventBus to subscribe to.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing EventBus with the following ARN.
   *
   * ```js
   * const busArn = "arn:aws:events:us-east-1:123456789012:event-bus/my-bus";
   * ```
   *
   * You can subscribe to it by passing in the ARN.
   *
   * ```js
   * sst.aws.Bus.subscribe(busArn, "src/subscriber.handler");
   * ```
   *
   * Add a pattern to the subscription.
   *
   * ```js
   * sst.aws.Bus.subscribe(busArn, "src/subscriber.handler", {
   *   pattern: {
   *     price_usd: [{numeric: [">=", 100]}]
   *   }
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js
   * sst.aws.Bus.subscribe(busArn, {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds"
   * });
   * ```
   */
  public static subscribe(
    busArn: Input<string>,
    subscriber: string | FunctionArgs,
    args?: BusSubscriberArgs,
  ) {
    const busName = output(busArn).apply(
      (busArn) => parseEventBusArn(busArn).busName,
    );
    return this._subscribeFunction(busName, busArn, subscriber, args);
  }

  private static _subscribeFunction(
    name: Input<string>,
    busArn: Input<string>,
    subscriber: string | FunctionArgs,
    args: BusSubscriberArgs = {},
  ) {
    return all([name, subscriber, args]).apply(([name, subscriber, args]) => {
      const prefix = sanitizeToPascalCase(name);
      const suffix = sanitizeToPascalCase(
        hashStringToPrettyString(
          [
            busArn,
            JSON.stringify(args.pattern ?? {}),
            typeof subscriber === "string" ? subscriber : subscriber.handler,
          ].join(""),
          6,
        ),
      );

      return new BusLambdaSubscriber(`${prefix}Subscriber${suffix}`, {
        bus: { name, arn: busArn },
        subscriber,
        ...args,
      });
    });
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        name: this.name,
        arn: this.nodes.bus.arn,
      },
    };
  }

  /** @internal */
  public getSSTAWSPermissions() {
    return [
      {
        actions: ["events:*"],
        resources: [this.nodes.bus.arn],
      },
    ];
  }
}

const __pulumiType = "sst:aws:Bus";
// @ts-expect-error
Bus.__pulumiType = __pulumiType;

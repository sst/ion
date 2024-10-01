import {
  ComponentResourceOptions,
  Input,
  Output,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { Function, FunctionArgs } from "./function";
import { BusSubscriberArgs } from "./bus";
import { cloudwatch, lambda } from "@pulumi/aws";
import { FunctionBuilder, functionBuilder } from "./helpers/function-builder";

export interface Args extends BusSubscriberArgs {
  /**
   * The bus to use.
   */
  bus: Input<{
    /**
     * The ARN of the bus.
     */
    arn: Input<string>;
    /**
     * The name of the bus.
     */
    name: Input<string>;
  }>;
  /**
   * The subscriber function.
   */
  subscriber: Input<string | FunctionArgs>;
}

/**
 * The `BusLambdaSubscriber` component is internally used by the `Bus` component
 * to add subscriptions to [Amazon EventBridge Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `subscribe` method of the `Bus` component.
 */
export class BusLambdaSubscriber extends Component {
  private readonly fn: FunctionBuilder;
  private readonly permission: lambda.Permission;
  private readonly rule: cloudwatch.EventRule;
  private readonly target: cloudwatch.EventTarget;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const bus = output(args.bus);
    const rule = createRule();
    const fn = createFunction();
    const permission = createPermission();
    const target = createTarget();
    const fnDescription = createDescription();

    this.fn = fn;
    this.permission = permission;
    this.rule = rule;
    this.target = target;

    function createDescription() {
      const subscriber = output(args.subscriber).get();
      if (typeof subscriber === "string" || !subscriber.description) {
        return interpolate`Subscribed to ${bus.name}`;
      }
      return output(subscriber.description);
    }

    function createFunction() {
      return functionBuilder(
        `${name}Function`,
        args.subscriber,
        {
          description: fnDescription,
        },
        undefined,
        { parent: self },
      );
    }

    function createPermission() {
      return new lambda.Permission(
        `${name}Permission`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "events.amazonaws.com",
          sourceArn: rule.arn,
        },
        { parent: self },
      );
    }

    function createRule() {
      return new cloudwatch.EventRule(
        ...transform(
          args?.transform?.rule,
          `${name}Rule`,
          {
            eventBusName: bus.name,
            eventPattern: args.pattern
              ? output(args.pattern).apply((pattern) =>
                  JSON.stringify({
                    "detail-type": pattern.detailType,
                    source: pattern.source,
                    detail: pattern.detail,
                  }),
                )
              : JSON.stringify({
                  source: [{ prefix: "" }],
                }),
          },
          { parent: self },
        ),
      );
    }

    function createTarget() {
      return new cloudwatch.EventTarget(
        ...transform(
          args?.transform?.target,
          `${name}Target`,
          {
            arn: fn.arn,
            rule: rule.name,
            eventBusName: bus.name,
          },
          { parent: self, dependsOn: [permission] },
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
       * The Lambda function that'll be notified.
       */
      function: this.fn.apply((fn) => fn.getFunction()),
      /**
       * The Lambda permission.
       */
      permission: this.permission,
      /**
       * The EventBus rule.
       */
      rule: this.rule,
      /**
       * The EventBus target.
       */
      target: this.target,
    };
  }
}

const __pulumiType = "sst:aws:BusLambdaSubscriber";
// @ts-expect-error
BusLambdaSubscriber.__pulumiType = __pulumiType;

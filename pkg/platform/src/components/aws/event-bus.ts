import { ComponentResourceOptions, output } from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";

export interface EventBusArgs {
    /**
     * [Transform](/docs/components#transform) how this component creates its underlying
     * resources.
     */
    transform?: {
        /**
         * Transform the EventBridge event bus resource.
         */
        eventBus?: Transform<aws.cloudwatch.EventBusArgs>;
    };
}

/**
 * The `EventBus` component lets you add an [Amazon EventBridge event bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html) to your app.
 *
 * #### Create the event bus
 *
 * ```ts
 * const bus = new sst.aws.EventBus("MyEventBus");
 * ```
 *
 */
export class EventBus
    extends Component
    implements Link.Linkable, Link.AWS.Linkable {
    private eventBus: aws.cloudwatch.EventBus;

    constructor(
        name: string,
        args: EventBusArgs = {},
        opts?: ComponentResourceOptions,
    ) {
        super(__pulumiType, name, args, opts);

        const parent = this;
        const eventBus = createEventBus();
        this.eventBus = eventBus;

        function createEventBus() {
            return new aws.cloudwatch.EventBus(
                `${name}EventBus`,
                transform(args.transform?.eventBus, {}),
                { parent },
            );
        }
    }

    /**
     * The Event Bus ID.
     */
    public get id() {
        return this.eventBus.id;
    }

    /**
     * The underlying [resources](/docs/components/#nodes) this component creates.
     */
    public get nodes() {
        return {
            /**
             * The CloudWatch (EventBridge) Event Bus.
             */
            eventBus: this.eventBus,
        };
    }

    /** @internal */
    public getSSTLink() {
        return {
            properties: {
                id: this.id,
            },
        };
    }

    /** @internal */
    public getSSTAWSPermissions() {
        return [
            {
                actions: ["events:*"],
                resources: [this.eventBus.arn],
            },
        ];
    }
}

const __pulumiType = "sst:aws:CloudWatchEventBus";
// @ts-expect-error
EventBus.__pulumiType = __pulumiType;

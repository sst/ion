import { ComponentResourceOptions, output, Output } from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Component, transform, Transform } from "../component";
import { Function, FunctionArgs } from "./function";
import type { Input } from "../input";
import { Link } from "../link";

export interface IoTAuthorizerArgs {
  /**
   * The Lambda function to be used as the authorizer.
   */
  handler: Input<string | FunctionArgs>;
  /**
   * The token key name to be used by the authorizer.
   *
   * @default "token"
   */
  tokenKeyName?: Input<string>;
  /**
   * The signing type to be used by the authorizer.
   *
   * @default false
   */
  signingDisabled?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the IoT Authorizer resource.
     */
    authorizer?: Transform<aws.iot.AuthorizerArgs>;
  };
}

/**
 * The `IoTAuthorizer` component lets you add an [IoT Authorizer](https://docs.aws.amazon.com/iot/latest/developerguide/iot-authorization.html) to your app.
 *
 * @example
 *
 * #### Create an IoT Authorizer
 *
 * ```ts
 * const authorizer = new sst.aws.IoTAuthorizer("MyAuthorizer", {
 *   handler: "src/authorizer.main",
 * });
 * ```
 *
 * #### Customize the token key name
 *
 * ```ts {4}
 * new sst.aws.IoTAuthorizer("MyAuthorizer", {
 *   handler: "src/authorizer.main",
 *   tokenKeyName: "custom_token_key"
 * });
 * ```
 *
 * #### Disable signing
 *
 * ```ts {4}
 * new sst.aws.IoTAuthorizer("MyAuthorizer", {
 *   handler: "src/authorizer.main",
 *   signingDisabled: true
 * });
 * ```
 */
export class IoTAuthorizer
  extends Component
  implements Link.Linkable, Link.AWS.Linkable
{
  private fn: Output<Function>;
  private authorizer: aws.iot.Authorizer;
  private constructorName: string;

  constructor(
    name: string,
    args: IoTAuthorizerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    this.constructorName = name;
    const parentName = this.constructorName;
    const tokenKeyName = args.tokenKeyName ?? "TOKEN";
    const signingDisabled = args.signingDisabled ?? false;

    const fn = createFunction();

    const authorizer = createAuthorizer();

    createPermission();

    this.fn = fn;
    this.authorizer = authorizer;

    function createFunction() {
      return output(args.handler).apply((handler) => {
        return Function.fromDefinition(
          `${name}Handler`,
          handler,
          {
            description: `IoT Authorizer function for ${name}`,
            permissions: [
              {
                actions: ["iot:DescribeThing", "iot:DescribeThingGroup"],
                resources: ["*"],
              },
            ],
          },
          {
            parent,
          },
        );
      });
    }

    function createAuthorizer() {
      return new aws.iot.Authorizer(
        `${parentName}Authorizer`,
        transform(args.transform?.authorizer, {
          authorizerFunctionArn: fn.arn,
          signingDisabled: signingDisabled,
          status: "ACTIVE",
          tokenKeyName: tokenKeyName,
        }),
        { parent },
      );
    }

    function createPermission() {
      return new aws.lambda.Permission(
        `${name}FunctionPermissions`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "iot.amazonaws.com",
          sourceArn: authorizer.arn,
        },
        { parent },
      );
    }
  }

  /**
   * The name of the IoT Authorizer.
   */
  public get authorizerName() {
    return this.authorizer.name;
  }

  /**
   * The ARN of the IoT Authorizer.
   */
  public get arn() {
    return this.authorizer.arn;
  }

  /**
   * The Endpoint of the IoT Authorizer.
   */
  public get endpointAddress() {
    return output(
      aws.iot.getEndpoint({
        endpointType: "iot:Data-ATS",
      }),
    ).apply((endpoint) => endpoint.endpointAddress);
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The IoT Authorizer resource.
       */
      authorizer: this.authorizer,
      /**
       * The Lambda Function resource.
       */
      function: this.fn,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        arn: this.arn,
      },
    };
  }

  /** @internal */
  public getSSTAWSPermissions() {
    return [
      {
        actions: ["iot:*"],
        resources: ["*"],
      },
    ];
  }
}

const __pulumiType = "sst:aws:IoTAuthorizer";
// @ts-expect-error
IoTAuthorizer.__pulumiType = __pulumiType;

import { Component, Prettify, transform, Transform } from "../component";
import { Link } from "../link";
import { prefixName } from "../naming";
import {
  all,
  ComponentResourceOptions,
  Input,
  interpolate,
  output,
  Output,
} from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export type StateMachinePermissionArgs = {
  /**
   * The [IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html#actions_table) that can be performed.
   * @example
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:*"]
   *     }
   *   ]
   * }
   * ```
   */
  actions: string[];
  /**
   * The resourcess specified using the [IAM ARN format](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html).
   * @example
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     }
   *   ]
   * }
   * ```
   */
  resources: Input<string>[];
};

export interface StateMachineArgs {
  definition: Input<string>;
  transform?: {
    /**
     * Transform the StateMachine resource.
     */
    stateMachine?: Transform<aws.sfn.StateMachineArgs>;

    /**
     * Transform the IAM Role resource.
     */
    role?: Transform<aws.iam.RoleArgs>;
  };
  /**
   * Determines whether a Standard or Express state machine is created. The default is `STANDARD`. You cannot update the type of a state machine once it has been created. Valid values: `STANDARD`, `EXPRESS`.
   */
  type?: Input<string>;

  /**
   * Assigns an existing IAM role to the state machine, replacing the default behavior of creating a new role.
   *
   * :::tip
   * Permissions specified in "permissions" and required by "link" resources are not added
   * automatically. You'll need to manually configure the IAM permissions required by the state machine.
   * :::
   *
   * @default Creates a new role.
   * @example
   * ```js
   * {
   *   role: "arn:aws:iam::123456789012:role/my-role"
   * }
   * ```
   */
  role?: Input<string>;

  /**
   * Configure the function to connect to private subnets in a virtual private cloud or VPC. This allows your function to access private resources.
   *
   * @example
   * ```js
   * {
   *   vpc: {
   *     securityGroups: ["sg-0399348378a4c256c"],
   *     subnets: ["subnet-0b6a2b73896dc8c4c", "subnet-021389ebee680c2f0"]
   *   }
   * }
   * ```
   */
  vpc?: Input<{
    /**
     * A list of VPC security group IDs.
     */
    securityGroups: Input<Input<string>[]>;
    /**
     * A list of VPC subnet IDs.
     */
    subnets: Input<Input<string>[]>;
  }>;

  /**
   * Permissions and the resources that the function needs to access. These permissions are
   * used to create the function's IAM role.
   *
   * :::tip
   * If you `link` the state machine to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow the state machine to read and write to an S3 bucket called `my-bucket`.
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:GetObject", "s3:PutObject"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Allow the state machine to perform all actions on an S3 bucket called `my-bucket`.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["s3:*"],
   *       resources: ["arn:aws:s3:::my-bucket/*"]
   *     },
   *   ]
   * }
   * ```
   *
   * Granting the state machine permissions to access all resources.
   *
   * ```js
   * {
   *   permissions: [
   *     {
   *       actions: ["*"],
   *       resources: ["*"]
   *     },
   *   ]
   * }
   * ```
   */
  permissions?: Input<Prettify<StateMachinePermissionArgs>[]>;

  /**
   * [Link resources](/docs/linking/) to your function. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your site using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the state machine.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: Input<any[]>;
}

export class StateMachine
  extends Component
  implements Link.Linkable, Link.AWS.Linkable
{
  private sfn: Output<aws.sfn.StateMachine>;

  constructor(
    name: string,
    args: StateMachineArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const region = normalizeRegion();
    const linkPermissions = buildLinkPermissions();
    const role = createRole();

    this.sfn = createStateMachine();

    function createStateMachine() {
      return all([args.definition, args.type, role]).apply(
        ([definition, type, role]) => {
          return new aws.sfn.StateMachine(
            `${name}StateMachine`,
            transform(args.transform?.stateMachine, {
              roleArn: role!.arn,
              definition: definition,
              type: type,
            }),
            { parent },
          );
        },
      );
    }

    function normalizeRegion() {
      return aws.getRegionOutput(undefined, { provider: opts?.provider }).name;
    }

    function buildLinkPermissions() {
      return output(args.link ?? []).apply((links) =>
        links.flatMap((l) => {
          if (!Link.AWS.isLinkable(l)) return [];
          return l.getSSTAWSPermissions();
        }),
      );
    }

    function createRole() {
      if (args.role) return;

      const policy = all([args.permissions || [], linkPermissions]).apply(
        ([argsPermissions, linkPermissions]) =>
          aws.iam.getPolicyDocumentOutput({
            statements: [...argsPermissions, ...linkPermissions],
          }),
      );

      return new aws.iam.Role(
        `${name}Role`,
        transform(args.transform?.role, {
          name: region.apply((region) =>
            prefixName(
              64,
              `${name}Role`,
              `-${region.toLowerCase().replace(/-/g, "")}`,
            ),
          ),
          assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
            Service: "states.amazonaws.com",
          }),
          // if there are no statements, do not add an inline policy.
          // adding an inline policy with no statements will cause an error.
          inlinePolicies: policy.apply(({ statements }) =>
            statements
              ? [
                  {
                    name: "inline",
                    policy: policy.json,
                  },
                ]
              : [],
          ),
          managedPolicyArns: [
            aws.iam.ManagedPolicy.AWSStepFunctionsFullAccess,
            ...(args.vpc
              ? [aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole]
              : []),
          ],
        }),
        { parent },
      );
    }
  }

  /**
   * The ARN of the State Machine
   */
  public get arn() {
    return this.sfn.arn;
  }

  /**
   * The name of the State Machine.
   */
  public get name() {
    return this.sfn.name;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon Step Functions statemachine.
       */
      statemachine: this.sfn,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        name: this.name,
        arn: this.arn,
      },
    };
  }

  /** @internal */
  public getSSTAWSPermissions() {
    return [
      {
        actions: ["states:StartExecution"],
        resources: [this.arn, interpolate`${this.arn}/*`],
      },
    ];
  }
}

const __pulumiType = "sst:aws:StateMachine";
// @ts-expect-error
StateMachine.__pulumiType = __pulumiType;

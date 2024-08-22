import {
  ComponentResourceOptions,
  Input,
  Output,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Function, FunctionArgs } from "./function";
import { apigatewayv2, lambda } from "@pulumi/aws";
import {
  ApiGatewayV2BaseRouteArgs,
  createApiRoute,
} from "./apigatewayv2-base-route";

export interface Args extends ApiGatewayV2BaseRouteArgs {
  /**
   * The route function.
   */
  handler: Input<string | FunctionArgs>;
  /**
   * @internal
   */
  handlerTransform?: Transform<FunctionArgs>;
}

/**
 * The `ApiGatewayV2LambdaRoute` component is internally used by the `ApiGatewayV2` component
 * to add routes to your [API Gateway HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `route` method of the `ApiGatewayV2` component.
 */
export class ApiGatewayV2LambdaRoute extends Component {
  private readonly fn: Output<Function>;
  private readonly permission: lambda.Permission;
  private readonly apiRoute: Output<apigatewayv2.Route>;
  private readonly integration: apigatewayv2.Integration;

  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;
    const api = output(args.api);
    const route = output(args.route);

    const fn = createFunction();
    const permission = createPermission();
    const integration = createIntegration();
    const apiRoute = createApiRoute(name, args, integration.id, self);

    this.fn = fn;
    this.permission = permission;
    this.apiRoute = apiRoute;
    this.integration = integration;

    function createFunction() {
      return Function.fromDefinition(
        `${name}Handler`,
        args.handler,
        {
          description: interpolate`${api.name} route ${route}`,
        },
        args.handlerTransform,
        { parent: self },
      );
    }

    function createPermission() {
      return new lambda.Permission(
        `${name}Permissions`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "apigateway.amazonaws.com",
          sourceArn: interpolate`${api.executionArn}/*`,
        },
        { parent: self },
      );
    }

    function createIntegration() {
      return new apigatewayv2.Integration(
        ...transform(
          args.transform?.integration,
          `${name}Integration`,
          {
            apiId: api.id,
            integrationType: "AWS_PROXY",
            integrationUri: fn.arn,
            payloadFormatVersion: "2.0",
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
       * The Lambda function.
       */
      function: this.fn,
      /**
       * The Lambda permission.
       */
      permission: this.permission,
      /**
       * The API Gateway HTTP API route.
       */
      route: this.apiRoute,
      /**
       * The API Gateway HTTP API integration.
       */
      integration: this.integration,
    };
  }
}

const __pulumiType = "sst:aws:ApiGatewayV2LambdaRoute";
// @ts-expect-error
ApiGatewayV2LambdaRoute.__pulumiType = __pulumiType;

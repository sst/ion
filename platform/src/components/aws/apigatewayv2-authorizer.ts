import {
  ComponentResourceOptions,
  Input,
  Output,
  output,
} from "@pulumi/pulumi";
import { Component, transform } from "../component";
import { ApiGatewayV2AuthorizerArgs } from "./apigatewayv2";
import { apigatewayv2, lambda } from "@pulumi/aws";
import { VisibleError } from "../error";
import { Function } from "./function";
import { interpolate } from "@pulumi/pulumi";
export interface AuthorizerArgs extends ApiGatewayV2AuthorizerArgs {
  /**
   * The API Gateway to use for the route.
   */
  api: Input<{
    /**
     * The name of the API Gateway.
     */
    name: Input<string>;
    /**
     * The ID of the API Gateway.
     */
    id: Input<string>;
    /**
     * The execution ARN of the API Gateway.
     */
    executionArn: Input<string>;
  }>;
}

/**
 * The `ApiGatewayV2Authorizer` component is internally used by the `ApiGatewayV2` component
 * to add authorizers to [Amazon API Gateway HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addAuthorizer` method of the `ApiGatewayV2` component.
 */
export class ApiGatewayV2Authorizer extends Component {
  private readonly authorizer: apigatewayv2.Authorizer;
  private readonly fn?: Output<Function>;
  private readonly permission?: lambda.Permission;
  constructor(
    name: string,
    args: AuthorizerArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const api = output(args.api);
    validateSingleAuthorizer();
    validateFunctionExistsIfCustomAuthorizer();
    const type = getType();
    const identitySources = getIdentitySources();
    const fn = createFunction();

    const authorizer = createAuthorizer();
    const permission = createPermission();

    this.authorizer = authorizer;
    this.fn = fn;
    this.permission = permission;

    function validateSingleAuthorizer() {
      const authorizers = [args.custom, args.jwt].filter((e) => e);

      if (!args.custom && !args.jwt)
        throw new VisibleError(
          `Please provide one of "custom" or "jwt" for the ${args.name} authorizer.`,
        );

      if (args.jwt && args.custom) {
        throw new VisibleError(
          `Please provide only one of "custom" or "jwt" for the ${args.name} authorizer.`,
        );
      }
    }

    function validateFunctionExistsIfCustomAuthorizer() {
      if (!args.custom) return;
      output(args.custom).apply((custom) => {
        if (!custom?.function) {
          throw new VisibleError(
            `Please provide a function for the ${args.name} authorizer.`,
          );
        }
      });
    }

    function getType() {
      if (args.jwt) return "JWT";
      if (args.custom) return "REQUEST";
    }

    function getIdentitySources() {
      if (args.jwt) {
        return [
          output(args.jwt).apply(
            (jwt) => jwt.identitySource ?? "$request.header.Authorization",
          ),
        ];
      }
      if (args.custom) {
        return output(args.custom).apply(
          (custom) =>
            custom.identitySources ?? ["$request.header.Authorization"],
        );
      }
    }

    function createFunction() {
      if (!args.custom) return;
      return Function.fromDefinition(
        `${name}Function`,
        output(args.custom).function,
        {
          description: interpolate`${api.name} authorizer`,
        },
      );
    }

    function createAuthorizer() {
      if (args.jwt) {
        return new apigatewayv2.Authorizer(
          ...transform(
            args.transform?.authorizer,
            `${name}Authorizer`,
            {
              apiId: api.id,
              authorizerType: type!,
              identitySources: identitySources,
              jwtConfiguration: output(args.jwt).apply((jwt) => ({
                audiences: jwt.audiences,
                issuer: jwt.issuer,
              })),
            },
            { parent: self },
          ),
        );
      }
      return new apigatewayv2.Authorizer(
        ...transform(
          args.transform?.authorizer,
          `${name}Authorizer`,
          {
            apiId: api.id,
            authorizerType: type!,
            identitySources: identitySources,
            authorizerResultTtlInSeconds: output(args.custom).apply(
              (custom) => custom!.ttl ?? 300,
            ),
            authorizerPayloadFormatVersion: "2.0",
            authorizerUri: fn?.nodes.function.invokeArn,
          },
          { parent: self },
        ),
      );
    }

    function createPermission() {
      if (!fn || !authorizer) return;
      return new lambda.Permission(
        `${name}Permission`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "apigateway.amazonaws.com",
          sourceArn: interpolate`${api.executionArn}/authorizers/${authorizer.id}`,
        },
        { parent: self },
      );
    }
  }

  /**
   * The ID of the authorizer.
   */
  public get id() {
    return this.authorizer.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;

    return {
      /**
       * The API Gateway V2 authorizer.
       */
      authorizer: this.authorizer,
      /**
       * The Lambda function used by the authorizer.
       */
      get function() {
        if (!self.fn)
          throw new VisibleError(
            "Cannot access `nodes.function` because the data source does not use a Lambda function.",
          );
        return self.fn;
      },
    };
  }
}

const __pulumiType = "sst:aws:ApiGatewayV2Authorizer";
// @ts-expect-error
ApiGatewayV2Authorizer.__pulumiType = __pulumiType;

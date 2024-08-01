import { ComponentResourceOptions } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Input } from "../input";
import { CognitoUserPoolClientArgs } from "./cognito-user-pool.js";
import { Link } from "../link";
import { cognito } from "@pulumi/aws";

export interface ClientArgs extends CognitoUserPoolClientArgs {
  /**
   * The Cognito user pool ID.
   */
  userPool: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Cognito User Pool client resource.
     */
    client?: Transform<cognito.UserPoolClientArgs>;
  };
}

/**
 * The `CognitoUserPoolClient` component is internally used by the `CognitoUserPool`
 * component to add clients to your [Amazon Cognito user pool](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addClient` method of the `CognitoUserPool` component.
 */
export class CognitoUserPoolClient extends Component implements Link.Linkable {
  private client: cognito.UserPoolClient;

  constructor(name: string, args: ClientArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const client = createClient();

    this.client = client;

    function createClient() {
      return new cognito.UserPoolClient(
        ...transform(
          args.transform?.client,
          `${name}Client`,
          {
            name,
            userPoolId: args.userPool,
            allowedOauthFlows: ["implicit", "code"],
            allowedOauthFlowsUserPoolClient: true,
            allowedOauthScopes: [
              "profile",
              "phone",
              "email",
              "openid",
              "aws.cognito.signin.user.admin",
            ],
            callbackUrls: ["https://example.com"],
            supportedIdentityProviders: ["COGNITO"],
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The Cognito User Pool client ID.
   */
  public get id() {
    return this.client.id;
  }

  /**
   * The Cognito User Pool client secret.
   */
  public get secret() {
    return this.client.clientSecret;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Cognito User Pool client.
       */
      client: this.client,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        id: this.id,
        secret: this.secret,
      },
    };
  }
}

const __pulumiType = "sst:aws:CognitoUserPoolClient";
// @ts-expect-error
CognitoUserPoolClient.__pulumiType = __pulumiType;

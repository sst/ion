import { ComponentResourceOptions } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Input } from "../input";
import { Link } from "../link";
import { cognito } from "@pulumi/aws";

export interface CognitoIdentityProviderArgs {
  /**
   * The Cognito user pool ID.
   */
  userPool: Input<string>;
  /**
   * The provider type. [See AWS API for valid values](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateIdentityProvider.html#CognitoUserPools-CreateIdentityProvider-request-ProviderType)
   */
  providerType: Input<string>;
  /**
   * The map of identity details. [See AWS API for valid values](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateIdentityProvider.html#CognitoUserPools-CreateIdentityProvider-request-ProviderDetails)
   */
  providerDetails: Input<Record<string, Input<string>>>;
  /**
   * The map of attribute mapping of user pool attributes. [AttributeMapping in AWS API documentation](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateIdentityProvider.html#CognitoUserPools-CreateIdentityProvider-request-AttributeMapping)
   */
  attributeMapping?: Input<Record<string, Input<string>>>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Cognito identity provider resource.
     */
    identityProvider?: Transform<cognito.IdentityProviderArgs>;
  };
}

/**
 * The `CognitoIdentityProvider` component is internally used by the `CognitoUserPool`
 * component to add identity providers to your [Amazon Cognito user pool](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html).
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `addIdentityProvider` method of the `CognitoUserPool` component.
 */
export class CognitoIdentityProvider extends Component implements Link.Linkable {
  private identityProvider: cognito.IdentityProvider;

  constructor(name: string, args: CognitoIdentityProviderArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const identityProvider = createIdentityProvider();

    this.identityProvider = identityProvider;

    function createIdentityProvider() {
      return new cognito.IdentityProvider(
        ...transform(
          args.transform?.identityProvider,
          `${name}IdentityProvider`,
          {
            userPoolId: args.userPool,
            providerName: args.providerType, // Use providerType as providerName by default
            providerType: args.providerType,
            providerDetails: args.providerDetails,
            attributeMapping: args.attributeMapping,
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The Cognito identity provider name.
   */
  public get providerName() {
    return this.identityProvider.providerName;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Cognito identity provider.
       */
      identityProvider: this.identityProvider,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        providerName: this.providerName,
      },
    };
  }
}

const __pulumiType = "sst:aws:CognitoIdentityProvider";
// @ts-expect-error
CognitoIdentityProvider.__pulumiType = __pulumiType;

/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "aws-cognito",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const userPool = new sst.aws.CognitoUserPool("MyUserPool", {
      triggers: {
        preSignUp: {
          handler: "index.handler",
        },
      },
    });

    const google = userPool.addIdentityProvider("Google", {
      providerType: "Google",
      providerDetails: {
        authorize_scopes: "email profile",
        client_id: "your_client_id",
        client_secret: "your_client_secret",
        attributes_url: "https://people.googleapis.com/v1/people/me?personFields=",
        attributes_url_add_attributes: "true",
        authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
        oidc_issuer: "https://accounts.google.com",
        token_request_method: "POST",
        token_url: "https://www.googleapis.com/oauth2/v4/token",
      },
    });
  
    const client = userPool.addClient("Web", {
      transform: {
        client: {
          supportedIdentityProviders: ["COGNITO", google.providerName],
        },
      },
    });

    const identityPool = new sst.aws.CognitoIdentityPool("MyIdentityPool", {
      userPools: [
        {
          userPool: userPool.id,
          client: client.id,
        },
      ],
    });

    return {
      UserPool: userPool.id,
      Client: client.id,
      IdentityPool: identityPool.id,
    };
  },
});

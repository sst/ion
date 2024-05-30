import {
  ComponentResourceOptions,
  Output,
  output,
  secret,
} from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Component, Transform } from "../component";
import { Link } from "../link";
import { FunctionArgs, Function } from "./function";
import { PrivateKey } from "@pulumi/tls";

export interface AuthArgs {
  authenticator: FunctionArgs;
  transform?: {
    bucketPolicy?: Transform<aws.s3.BucketPolicyArgs>;
  };
}

export class Auth extends Component implements Link.Linkable {
  private readonly _key: PrivateKey;
  private readonly _authenticator: Output<Function>;

  constructor(name: string, args: AuthArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    this._key = new PrivateKey(`${name}Keypair`, {
      algorithm: "RSA",
    });

    this._authenticator = output(args.authenticator).apply((args) => {
      return new Function(`${name}Authenticator`, {
        ...args,
        url: args.url || true,
        streaming: !$dev,
        environment: {
          ...args.environment,
          AUTH_PRIVATE_KEY: secret(this.key.privateKeyPemPkcs8),
          AUTH_PUBLIC_KEY: secret(this.key.publicKeyPem),
        },
      });
    });
  }

  public get key() {
    return this._key;
  }

  public get authenticator() {
    return this._authenticator;
  }

  public get url() {
    return this._authenticator.url!;
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        publicKey: secret(this.key.publicKeyPem),
      },
    };
  }

  /** @internal */
  public getSSTAWSPermissions() {
    return [];
  }
}

const __pulumiType = "sst:aws:Auth";
// @ts-expect-error
Auth.__pulumiType = __pulumiType;

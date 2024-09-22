import {
  ComponentResourceOptions,
  Output,
  all,
  interpolate,
  output,
} from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Link } from "../link";
import { Input } from "../input";
import { Dns } from "../dns";
import { SnsTopic } from "./sns-topic";
import { dns as awsDns } from "./dns.js";
import { ses, sesv2 } from "@pulumi/aws";
import { permission } from "./permission";

export interface EmailArgs {
  /**
   * The email address or domain name that you want to send emails from.
   *
   * :::note
   * You'll need to verify the email address or domain you are using.
   * :::
   *
   * @example
   *
   * Using an email address as the sender. You'll need to verify the email address.
   * When you deploy your app, you will receive an email from AWS SES with a link to verify the
   * email address.
   *
   * ```ts
   * {
   *   sender: "john.smith@gmail.com"
   * }
   * ```
   *
   * Using a domain name as the sender. You'll need to verify that you own the domain.
   * Once you verified, you can send emails from any email addresses in the domain.
   *
   * :::tip
   * SST can automatically verify the domain for the `dns` adapter that's specified.
   * :::
   *
   * To verify the domain, you need to add the verification records to your domain's DNS.
   * This can be done automatically for the supported `dns` adapters.
   *
   * ```ts
   * {
   *   sender: "example.com"
   * }
   * ```
   *
   * If the domain is hosted on Cloudflare.
   *
   * ```ts
   * {
   *   sender: "example.com",
   *   dns: sst.cloudflare.dns()
   * }
   * ```
   */
  sender: Input<string>;
  /**
   * The DNS adapter you want to use for managing DNS records. Only specify this if you
   * are using a domain name as the `sender`.
   *
   * :::note
   * If `dns` is set to `false`, you have to add the DNS records manually to verify
   * the domain.
   * :::
   *
   * @default `sst.aws.dns`
   *
   * @example
   *
   * Specify the hosted zone ID for the domain.
   *
   * ```js
   * {
   *   dns: sst.aws.dns({
   *     zone: "Z2FDTNDATAQYW2"
   *   })
   * }
   * ```
   *
   * Domain is hosted on Cloudflare.
   *
   * ```js
   * {
   *   dns: sst.cloudflare.dns()
   * }
   * ```
   */
  dns?: Input<false | (Dns & {})>;
  /**
   * The DMARC policy for the domain. This'll create a DNS record with the given DMARC policy.
   * Only specify this if you are using a domain name as the `sender`.
   *
   * @default `"v=DMARC1; p=none;"`
   *
   * @example
   * ```js
   * {
   *   dmarc: "v=DMARC1; p=quarantine; adkim=s; aspf=s;"
   * }
   * ```
   */
  dmarc?: Input<string>;

  /**
   * The SNS topics to publish bounce, complaint, and delivery notifications to. To see how to properly proccess bounces and complaints please  read [Setting up event notifications for Amazon SES]{@link https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html}
   *
   * @example
   *
   * ```js
   * {
   *   publishers: {
   *     Bounce: topic,
   *     Complaint: topic,
   *     Delivery: topic,
   *   }
   * }
   * ```
   */

  publishers?: Partial<
    Record<"Bounce" | "Complaint" | "Delivery", Input<SnsTopic>>
  >;

  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the SES identity resource.
     */
    identity?: Transform<sesv2.EmailIdentityArgs>;
  };
}

interface EmailRef {
  ref: boolean;
  identity: sesv2.EmailIdentity;
}

/**
 * The `Email` component lets you send emails in your app.
 * It uses [Amazon Simple Email Service](https://aws.amazon.com/ses/).
 *
 * You can configure it to send emails from a specific email address or from any email addresses
 * in a domain.
 *
 * :::tip
 * New AWS SES accounts are in _sandbox mode_ and need to [request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
 * :::
 *
 * By default, new AWS SES accounts are in the _sandbox mode_ and can only send
 * email to verified email addresses and domains. It also limits your account has to a sending
 * quota. To remove these restrictions, you need to [request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
 *
 * #### Sending from an email address
 *
 * For using an email address as the sender, you need to verify the email address.
 *
 * ```ts title="sst.config.ts"
 * const email = new sst.aws.Email("MyEmail", {
 *   sender: "spongebob@example.com",
 * });
 * ```
 *
 * #### Sending from a domain
 *
 * When you use a domain as the sender, you'll need to verify that you own the domain.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Email("MyEmail", {
 *   sender: "example.com"
 * });
 * ```
 *
 * #### Configuring DMARC
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Email("MyEmail", {
 *   sender: "example.com",
 *   dmarc: "v=DMARC1; p=quarantine; adkim=s; aspf=s;"
 * });
 * ```
 *
 * #### Link to a resource
 *
 * You can link it to a function or your Next.js app to send emails.
 *
 * ```ts {3} title="sst.config.ts"
 * new sst.aws.Function("MyApi", {
 *   handler: "sender.handler",
 *   link: [email]
 * });
 * ```
 *
 * Now in your function you can use the AWS SES SDK to send emails.
 *
 * ```ts title="sender.ts" {1, 8}
 * import { Resource } from "sst";
 * import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
 *
 * const client = new SESv2Client();
 *
 * await client.send(
 *   new SendEmailCommand({
 *     FromEmailAddress: Resource.MyEmail.sender,
 *     Destination: {
 *       ToAddresses: ["patrick@example.com"]
 *     },
 *     Content: {
 *       Simple: {
 *         Subject: { Data: "Hello World!" },
 *         Body: { Text: { Data: "Sent from my SST app." } }
 *       }
 *     }
 *   })
 * );
 * ```
 */
export class Email extends Component implements Link.Linkable {
  private _sender: Output<string>;
  private identity: sesv2.EmailIdentity;

  constructor(name: string, args: EmailArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    if (args && "ref" in args) {
      const ref = args as unknown as EmailRef;
      this._sender = ref.identity.emailIdentity;
      this.identity = ref.identity;
      return;
    }

    const parent = this;
    const isDomain = checkIsDomain();
    const dns = normalizeDns();
    const dmarc = normalizeDmarc();
    const identity = createIdentity();
    isDomain.apply((isDomain) => {
      if (!isDomain) return;
      createDkimRecords();
      createDmarcRecord();
      waitForVerification();
    });

    createIdentityPublishers();

    this._sender = output(args.sender);
    this.identity = identity;

    function checkIsDomain() {
      return output(args.sender).apply((sender) => !sender.includes("@"));
    }

    function normalizeDns() {
      all([args.dns, isDomain]).apply(([dns, isDomain]) => {
        if (!isDomain && dns)
          throw new Error(
            `The "dns" property is only valid when "sender" is a domain.`,
          );
      });

      return args.dns ?? awsDns();
    }

    function normalizeDmarc() {
      all([args.dmarc, isDomain]).apply(([dmarc, isDomain]) => {
        if (!isDomain && dmarc)
          throw new Error(
            `The "dmarc" property is only valid when "sender" is a domain.`,
          );
      });

      return args.dmarc ?? `v=DMARC1; p=none;`;
    }

    function createIdentity() {
      return new sesv2.EmailIdentity(
        ...transform(
          args.transform?.identity,
          `${name}Identity`,
          { emailIdentity: args.sender },
          { parent },
        ),
      );
    }

    function createDkimRecords() {
      all([dns, identity?.dkimSigningAttributes.tokens]).apply(
        ([dns, tokens]) => {
          if (!dns) return;

          tokens?.map((token) =>
            dns.createRecord(
              name,
              {
                type: "CNAME",
                name: interpolate`${token}._domainkey.${args.sender}`,
                value: `${token}.dkim.amazonses.com`,
              },
              { parent },
            ),
          );
        },
      );
    }

    function createDmarcRecord() {
      output(dns).apply((dns) => {
        if (!dns) return;

        dns.createRecord(
          name,
          {
            type: "TXT",
            name: interpolate`_dmarc.${args.sender}`,
            value: dmarc,
          },
          { parent },
        );
      });
    }

    function createIdentityPublishers() {
      all([args.publishers, identity]).apply(([topic, identity]) => {
        if (!topic) return;

        const types = Array.from(Object.keys(topic)) as Array<
          "Bounce" | "Complaint" | "Delivery"
        >;

        if (types.length === 0) return;
        // i used map because i saw it above but shouldn't you use forEach?
        types.map(
          (event) =>
            new ses.IdentityNotificationTopic(`${event}-Notification`, {
              identity: identity.arn,
              notificationType: event,
              topicArn: topic[event]?.arn,
            }),
        );
      });
    }

    function waitForVerification() {
      new ses.DomainIdentityVerification(
        `${name}Verification`,
        {
          domain: args.sender,
        },
        { parent, dependsOn: identity },
      );
    }
  }

  /**
   * The sender email address or domain name.
   */
  public get sender() {
    return this._sender;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon SES identity.
       */
      identity: this.identity,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        sender: this._sender,
      },
      include: [
        permission({
          actions: ["ses:*"],
          resources: [this.identity.arn],
        }),
      ],
    };
  }

  /**
   * Reference an existing Email component with the given Amazon SES identity. This is useful
   * when you create an SES identity in one stage and want to share it in another stage. It
   * avoids having to create a new Email component in the other stage.
   *
   * @param name The name of the component.
   * @param sender The email address or domain name of the existing SES identity.
   *
   * @example
   * Imagine you create an Email component in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new component, you want to share the one from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const email = $app.stage === "frank"
   *   ? sst.aws.Email.get("MyEmail", "spongebob@example.com")
   *   : new sst.aws.Email("MyEmail", {
   *       sender: "spongebob@example.com",
   *     });
   * ```
   */
  public static get(name: string, sender: Input<string>) {
    const identity = sesv2.EmailIdentity.get(`${name}Identity`, sender);
    return new Email(name, { ref: true, identity } as unknown as EmailArgs);
  }
}

const __pulumiType = "sst:aws:Email";
// @ts-expect-error
Email.__pulumiType = __pulumiType;

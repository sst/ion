import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Function } from "./function.js";
import {
  SsrSiteArgs,
  createBucket,
  createDevServer,
  createServersAndDistribution,
  prepare,
  useCloudFrontFunctionHostHeaderInjection,
  validatePlan,
} from "./ssr-site.js";
import { Cdn } from "./cdn.js";
import { Bucket } from "./bucket.js";
import { Component } from "../component.js";
import { Link } from "../link.js";
import { buildApp } from "../base/base-ssr-site.js";
import { VisibleError } from "../error.js";
import { URL_UNAVAILABLE } from "./linkable.js";

export interface SolidStartArgs extends SsrSiteArgs {
  /**
   * The number of instances of the [server function](#nodes-server) to keep warm. This is useful for cases where you are experiencing long cold starts. The default is to not keep any instances warm.
   *
   * This works by starting a serverless cron job to make _n_ concurrent requests to the server function every few minutes. Where _n_ is the number of instances to keep warm.
   *
   * @default `0`
   */
  warm?: SsrSiteArgs["warm"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your SolidStart app needs to access. These permissions are used to create the function's IAM role.
   *
   * :::tip
   * If you `link` the function to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow reading and writing to an S3 bucket called `my-bucket`.
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
   * Perform all actions on an S3 bucket called `my-bucket`.
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
   * Grant permissions to access all resources.
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
  permissions?: SsrSiteArgs["permissions"];
  /**
   * Path to the directory where your SolidStart app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your SolidStart app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your SolidStart app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your SolidStart app. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your site using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of resources to link to the function.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: SsrSiteArgs["link"];
  /**
   * Configure how the CloudFront cache invalidations are handled. This is run after your SolidStart app has been deployed.
   * :::tip
   * You get 1000 free invalidations per month. After that you pay $0.005 per invalidation path. [Read more here](https://aws.amazon.com/cloudfront/pricing/).
   * :::
   * @default `{paths: "all", wait: false}`
   * @example
   * Wait for all paths to be invalidated.
   * ```js
   * {
   *   invalidation: {
   *     paths: "all",
   *     wait: true
   *   }
   * }
   * ```
   */
  invalidation?: SsrSiteArgs["invalidation"];
  /**
   * Set in your SolidStart app. These are made available:
   *
   * 1. In `vinxi build`, they are loaded into `process.env`.
   * 2. Locally while running `sst dev vinxi dev`.
   *
   * :::tip
   * You can also `link` resources to your SolidStart app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
   * :::
   *
   * @example
   * ```js
   * {
   *   environment: {
   *     API_URL: api.url,
   *     STRIPE_PUBLISHABLE_KEY: "pk_test_123"
   *   }
   * }
   * ```
   */
  environment?: SsrSiteArgs["environment"];
  /**
   * Set a custom domain for your SolidStart app.
   *
   * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
   * providers, you'll need to pass in a `cert` that validates domain ownership and add the
   * DNS records.
   *
   * :::tip
   * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
   * providers.
   * :::
   *
   * @example
   *
   * By default this assumes the domain is hosted on Route 53.
   *
   * ```js
   * {
   *   domain: "example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   *
   * Specify a `www.` version of the custom domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  domain?: SsrSiteArgs["domain"];
  /**
   * The command used internally to build your SolidStart app.
   *
   * @default `"npm run build"`
   *
   * @example
   *
   * If you want to use a different build command.
   * ```js
   * {
   *   buildCommand: "yarn build"
   * }
   * ```
   */
  buildCommand?: SsrSiteArgs["buildCommand"];
  /**
   * Configure how the SolidStart app assets are uploaded to S3.
   *
   * By default, this is set to the following. Read more about these options below.
   * ```js
   * {
   *   assets: {
   *     textEncoding: "utf-8",
   *     versionedFilesCacheHeader: "public,max-age=31536000,immutable",
   *     nonVersionedFilesCacheHeader: "public,max-age=0,s-maxage=86400,stale-while-revalidate=8640"
   *   }
   * }
   * ```
   */
  assets?: SsrSiteArgs["assets"];
  /**
   * Configure the [server function](#nodes-server) in your SolidStart app to connect
   * to private subnets in a virtual private cloud or VPC. This allows your app to
   * access private resources.
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
  vpc?: SsrSiteArgs["vpc"];
}

/**
 * The `SolidStart` component lets you deploy a [SolidStart](https://start.solidjs.com) app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a SolidStart app that's in the project root.
 *
 * ```js
 * new sst.aws.SolidStart("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the SolidStart app in the `my-solid-app/` directory.
 *
 * ```js {2}
 * new sst.aws.SolidStart("MyWeb", {
 *   path: "my-solid-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your SolidStart app.
 *
 * ```js {2}
 * new sst.aws.SolidStart("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4}
 * new sst.aws.SolidStart("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your SolidStart app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4}
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.SolidStart("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your SolidStart app.
 *
 * ```ts title="src/app.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class SolidStart extends Component implements Link.Linkable {
  private cdn?: Output<Cdn>;
  private assets?: Bucket;
  private server?: Output<Function>;

  constructor(
    name: string,
    args: SolidStartArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const { sitePath, partition } = prepare(args, opts);
    if ($dev) {
      const server = createDevServer(parent, name, args);
      this.registerOutputs({
        _metadata: {
          mode: "placeholder",
          path: sitePath,
          server: server.arn,
        },
        _receiver: {
          directory: sitePath,
          links: output(args.link || [])
            .apply(Link.build)
            .apply((links) => links.map((link) => link.name)),
          aws: {
            role: server.nodes.role.arn,
          },
          environment: args.environment,
        },
        _dev: {
          directory: sitePath,
          links: output(args.link || [])
            .apply(Link.build)
            .apply((links) => links.map((link) => link.name)),
          aws: {
            role: server.nodes.role.arn,
          },
          environment: args.environment,
          command: "npm run dev",
        },
      });
      return;
    }

    const { access, bucket } = createBucket(parent, name, partition, args);
    const outputPath = buildApp(name, args, sitePath).apply((output) => {
      const nitro = JSON.parse(
        fs.readFileSync(path.join(output, ".output/nitro.json")).toString(),
      );
      if (nitro.preset !== "aws-lambda-streaming") {
        throw new VisibleError(
          'SolidStart app does not seem to be configured with the right preset. Be sure to specify `preset: "aws-lambda-streaming"` in your `app.config.ts`.',
        );
      }
      return output;
    });
    const buildMeta = loadBuildMetadata();
    const plan = buildPlan();
    const { distribution, ssrFunctions, edgeFunctions } =
      createServersAndDistribution(
        parent,
        name,
        args,
        outputPath,
        access,
        bucket,
        plan,
      );
    const serverFunction = ssrFunctions[0] ?? Object.values(edgeFunctions)[0];

    this.assets = bucket;
    this.cdn = distribution;
    this.server = serverFunction;
    this.registerOutputs({
      _hint: all([this.cdn.domainUrl, this.cdn.url]).apply(
        ([domainUrl, url]) => domainUrl ?? url,
      ),
      _metadata: {
        mode: "deployed",
        path: sitePath,
        url: distribution.apply((d) => d.domainUrl ?? d.url),
        server: serverFunction.arn,
      },
    });

    function loadBuildMetadata() {
      return outputPath.apply((outputPath) => {
        const assetsPath = path.join(".output", "public");

        return {
          assetsPath,
          // create 1 behaviour for each top level asset file/folder
          staticRoutes: fs
            .readdirSync(path.join(outputPath, assetsPath))
            .map((item) =>
              fs.statSync(path.join(outputPath, assetsPath, item)).isDirectory()
                ? `${item}/*`
                : item,
            ),
        };
      });
    }

    function buildPlan() {
      return all([outputPath, buildMeta]).apply(([outputPath, buildMeta]) => {
        const serverConfig = {
          description: "Server handler for Solid",
          handler: "index.handler",
          bundle: path.join(outputPath, ".output", "server"),
          streaming: true,
        };

        return validatePlan({
          edge: false,
          cloudFrontFunctions: {
            serverCfFunction: {
              injections: [useCloudFrontFunctionHostHeaderInjection()],
            },
          },
          origins: {
            server: {
              server: {
                function: serverConfig,
              },
            },
            s3: {
              s3: {
                copy: [
                  {
                    from: buildMeta.assetsPath,
                    to: "",
                    cached: true,
                  },
                ],
              },
            },
          },
          behaviors: [
            {
              cacheType: "server",
              cfFunction: "serverCfFunction",
              origin: "server",
            },
            {
              pattern: "_server/",
              cacheType: "server",
              cfFunction: "serverCfFunction",
              origin: "server",
            },
            ...buildMeta.staticRoutes.map(
              (route) =>
                ({
                  cacheType: "static",
                  pattern: route,
                  origin: "s3",
                }) as const,
            ),
          ],
        });
      });
    }
  }

  /**
   * The URL of the SolidStart app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated CloudFront URL.
   */
  public get url() {
    if (!this.cdn) return;

    return all([this.cdn.domainUrl, this.cdn.url]).apply(
      ([domainUrl, url]) => domainUrl ?? url,
    );
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The AWS Lambda server function that renders the site.
       */
      server: this.server,
      /**
       * The Amazon S3 Bucket that stores the assets.
       */
      assets: this.assets,
      /**
       * The Amazon CloudFront CDN that serves the site.
       */
      cdn: this.cdn,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url:
          this.url?.apply((url) => url || URL_UNAVAILABLE) || URL_UNAVAILABLE,
      },
    };
  }
}

const __pulumiType = "sst:aws:SolidStart";
// @ts-expect-error
SolidStart.__pulumiType = __pulumiType;

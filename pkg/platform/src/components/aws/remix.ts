import fs from "fs";
import path from "path";
import { ComponentResourceOptions, Output, all, output } from "@pulumi/pulumi";
import { Function } from "./function.js";
import {
  SsrSiteArgs,
  buildApp,
  createBucket,
  createServersAndDistribution,
  prepare,
  useCloudFrontFunctionHostHeaderInjection,
  validatePlan,
} from "./ssr-site.js";
import { Cdn } from "./cdn.js";
import { Bucket } from "./bucket.js";
import { Component, transform } from "../component.js";
import { Hint } from "../hint.js";
import { Link } from "../link.js";
import type { Input } from "../input.js";

export interface RemixArgs extends SsrSiteArgs {
  /**
   * The number of instances of the [server function](#nodes-server) to keep warm. This is useful for cases where you are experiencing long cold starts. The default is to not keep any instances warm.
   *
   * This works by starting a serverless cron job to make _n_ concurrent requests to the server function every few minutes. Where _n_ is the number of instances to keep warm.
   *
   * @default `0`
   */
  warm?: SsrSiteArgs["warm"];
  /**
   * Permissions and the resources that the [server function](#nodes-server) in your Remix app needs to access. These permissions are used to create the function's IAM role.
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
   * Path to the directory where your Remix app is located.  This path is relative to your `sst.config.ts`.
   *
   * By default it assumes your Remix app is in the root of your SST app.
   * @default `"."`
   *
   * @example
   *
   * If your Remix app is in a package in your monorepo.
   *
   * ```js
   * {
   *   path: "packages/web"
   * }
   * ```
   */
  path?: SsrSiteArgs["path"];
  /**
   * [Link resources](/docs/linking/) to your Remix app. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your site using the [Node client](/docs/reference/client/).
   *
   * @example
   *
   * Takes a list of resources to link to the function.
   *
   * ```js
   * {
   *   link: [myBucket, stripeKey]
   * }
   * ```
   */
  link?: SsrSiteArgs["link"];
  /**
   * Configure how the CloudFront cache invalidations are handled. This is run after your Remix app has been deployed.
   * :::tip
   * You get 1000 free invalidations per month. After that you pay $0.005 per invalidation path. [Read more here](https://aws.amazon.com/cloudfront/pricing/).
   * :::
   * @default `&lcub;paths: "all", wait: false&rcub;`
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
   * Set [environment variables](https://remix.run/docs/en/main/guides/envvars) in your Remix app. These are made available:
   *
   * 1. In `remix build`, they are loaded into `process.env`.
   * 2. Locally while running `sst dev remix dev`.
   *
   * :::tip
   * You can also `link` resources to your Remix app and access them in a type-safe way with the [Node client](/docs/reference/client/). We recommend linking since it's more secure.
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
   * Set a custom domain for your Remix app. Supports domains hosted either on
   * [Route 53](https://aws.amazon.com/route53/) or outside AWS.
   *
   * :::tip
   * You can also migrate an externally hosted domain to Amazon Route 53 by
   * [following this guide](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/MigratingDNS.html).
   * :::
   *
   * @example
   *
   * ```js
   * {
   *   domain: "domain.com"
   * }
   * ```
   *
   * Specify the Route 53 hosted zone and a `www.` version of the custom domain.
   *
   * ```js
   * {
   *   domain: {
   *     domainName: "domain.com",
   *     hostedZone: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  domain?: SsrSiteArgs["domain"];
  /**
   * The command used internally to build your Remix app.
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
   * Configure how the Remix app assets are uploaded to S3.
   */
  assets?: SsrSiteArgs["assets"];
  /**
   * Configure where the [server function](#nodes-server) is deployed.
   *
   * By default, it's deployed to AWS Lambda in a single region. Enable this option if you want to instead deploy it to Lambda@Edge.
   * @default `false`
   */
  edge?: Input<boolean>;
}

/**
 * The `Remix` component lets you deploy a Remix app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a Remix app that's in the project root.
 *
 * ```js
 * new sst.aws.Remix("Web");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Remix app in the `my-remix-app/` directory.
 *
 * ```js {2}
 * new sst.aws.Remix("Web", {
 *   path: "my-remix-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Remix app.
 *
 * ```js {2}
 * new sst.aws.Remix("Web", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4}
 * new sst.aws.Remix("Web", {
 *   domain: {
 *     domainName: "my-app.com",
 *     redirects: ["www.my-app.com"]
 *   }
 * });
 * ```
 *
 * #### Link resources
 *
 * [Link resources](/docs/linking/) to your Remix app. This will grant permissions
 * to the resources and allow you to access it in your app.
 *
 * ```ts {4}
 * const myBucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Remix("Web", {
 *   link: [myBucket]
 * });
 * ```
 *
 * You can use the [Node client](/docs/reference/client/) to access the linked resources
 * in your Remix app.
 *
 * ```ts title="app/root.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class Remix extends Component implements Link.Linkable {
  private cdn: Output<Cdn>;
  private assets: Bucket;
  private server: Output<Function>;

  constructor(
    name: string,
    args: RemixArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super("sst:aws:Remix", name, args, opts);

    const parent = this;
    const edge = normalizeEdge();
    const { sitePath, region } = prepare(args, opts);
    const { access, bucket } = createBucket(parent, name);
    const outputPath = buildApp(name, args, sitePath);
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
    Hint.register(
      this.urn,
      all([this.cdn.domainUrl, this.cdn.url]).apply(
        ([domainUrl, url]) => domainUrl ?? url,
      ),
    );
    this.registerOutputs({
      _metadata: {
        mode: $dev ? "placeholder" : "deployed",
        path: sitePath,
        customDomainUrl: this.cdn.domainUrl,
        edge,
      },
    });

    function normalizeEdge() {
      return output(args?.edge).apply((edge) => edge ?? false);
    }

    function buildPlan() {
      return all([outputPath, edge]).apply(([outputPath, edge]) => {
        const serverConfig = createServerLambdaBundle(
          outputPath,
          edge ? "edge-server.mjs" : "regional-server.mjs",
        );

        return validatePlan(
          transform(args?.transform?.plan, {
            edge,
            cloudFrontFunctions: {
              serverCfFunction: {
                injections: [useCloudFrontFunctionHostHeaderInjection()],
              },
              staticCfFunction: {
                injections: [
                  // Note: When using libraries like remix-flat-routes the file can
                  // contains special characters like "+". It needs to be encoded.
                  `request.uri = request.uri.split('/').map(encodeURIComponent).join('/');`,
                ],
              },
            },
            edgeFunctions: edge
              ? {
                  server: {
                    function: serverConfig,
                  },
                }
              : undefined,
            origins: {
              ...(edge
                ? {}
                : {
                    server: {
                      server: {
                        function: serverConfig,
                      },
                    },
                  }),
              s3: {
                s3: {
                  copy: [
                    {
                      from: "public",
                      to: "",
                      cached: true,
                      versionedSubDir: "build",
                    },
                  ],
                },
              },
            },
            behaviors: [
              edge
                ? {
                    cacheType: "server",
                    cfFunction: "serverCfFunction",
                    edgeFunction: "server",
                    origin: "s3",
                  }
                : {
                    cacheType: "server",
                    cfFunction: "serverCfFunction",
                    origin: "server",
                  },
              // create 1 behaviour for each top level asset file/folder
              ...fs.readdirSync(path.join(outputPath, "public")).map(
                (item) =>
                  ({
                    cacheType: "static",
                    pattern: fs
                      .statSync(path.join(outputPath, "public", item))
                      .isDirectory()
                      ? `${item}/*`
                      : item,
                    cfFunction: "staticCfFunction",
                    origin: "s3",
                  }) as const,
              ),
            ],
          }),
        );
      });
    }

    function createServerLambdaBundle(outputPath: string, wrapperFile: string) {
      // Create a Lambda@Edge handler for the Remix server bundle.
      //
      // Note: Remix does perform their own internal ESBuild process, but it
      // doesn't bundle 3rd party dependencies by default. In the interest of
      // keeping deployments seamless for users we will create a server bundle
      // with all dependencies included. We will still need to consider how to
      // address any need for external dependencies, although I think we should
      // possibly consider this at a later date.

      // In this path we are assuming that the Remix build only outputs the
      // "core server build". We can safely assume this as we have guarded the
      // remix.config.js to ensure it matches our expectations for the build
      // configuration.
      // We need to ensure that the "core server build" is wrapped with an
      // appropriate Lambda@Edge handler. We will utilise an internal asset
      // template to create this wrapper within the "core server build" output
      // directory.

      // Ensure build directory exists
      const buildPath = path.join(outputPath, "build");
      fs.mkdirSync(buildPath, { recursive: true });

      // Copy the server lambda handler
      fs.copyFileSync(
        path.join(
          $cli.paths.platform,
          "functions",
          "remix-server",
          wrapperFile,
        ),
        path.join(buildPath, "server.mjs"),
      );

      // Copy the Remix polyfil to the server build directory
      //
      // Note: We need to ensure that the polyfills are injected above other code that
      // will depend on them. Importing them within the top of the lambda code
      // doesn't appear to guarantee this, we therefore leverage ESBUild's
      // `inject` option to ensure that the polyfills are injected at the top of
      // the bundle.
      const polyfillDest = path.join(buildPath, "polyfill.mjs");
      fs.copyFileSync(
        path.join(
          $cli.paths.platform,
          "functions",
          "remix-server",
          "polyfill.mjs",
        ),
        polyfillDest,
      );

      return {
        handler: path.join(buildPath, "server.handler"),
        nodejs: {
          esbuild: {
            inject: [path.resolve(polyfillDest)],
          },
        },
      };
    }
  }

  /**
   * The autogenerated CloudFront URL of the Remix app.
   */
  public get url() {
    return this.cdn.url;
  }

  /**
   * If the `domain` is set, this is the URL of the Remix app with the
   * custom domain.
   */
  public get domainUrl() {
    return this.cdn.domainUrl;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The AWS Lambda server function that renders the site.
       */
      server: this.server as unknown as Function,
      /**
       * The Amazon S3 Bucket that stores the assets.
       */
      assets: this.assets,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.url,
      },
    };
  }
}

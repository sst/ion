import fs from "fs";
import path from "path";
import { pathToRegexp } from "path-to-regexp";
import { ComponentResourceOptions, Output, all, jsonStringify, output } from "@pulumi/pulumi";
import {
  SsrSiteArgs,
  createKvStorage,
  createRouter,
  prepare,
  validatePlan,
} from "./ssr-site.js";
import { Component } from "../component.js";
import { Hint } from "../hint.js";
import { Link } from "../link.js";
import { Kv } from "./kv.js";
import { buildApp, getContentType } from "../base/base-ssr-site.js";
import { Worker, WorkerArgs } from "./worker.js";
import { Plugin } from "esbuild";

// Aws specific imports
import {Bucket} from '../aws/bucket.js'
import {Function} from '../aws/function.js'
import { 
  OpenNextServerFunctionOrigin,
  loadOpenNextOutput, 
  loadOpenNextOutputPlaceholder, 
  loadPrerenderManifest,
  normalizeBuildCommand
} from "../base/base-next.js";
import { Queue } from "../aws/queue.js";
import * as aws from "@pulumi/aws";
import { BucketFile, BucketFiles } from "../aws/providers/bucket-files.js";
import { BaseSiteFileOptions } from "../base/base-site.js";
import { globSync } from "glob";
import crypto from "crypto";


export interface NextArgs extends SsrSiteArgs {
  /**
   * Configure how the Next app assets are uploaded to S3.
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
   * The command used internally to build your Remix app.
   *
   * @default `"npx open-next build"`
   *
   * @example
   *
   * If you want to use a different build command.
   * ```js
   * {
   *   buildCommand: "npm run custom-build"
   * }
   * ```
   */
  buildCommand?: SsrSiteArgs["buildCommand"];
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
   * Set [environment variables](https://remix.run/docs/en/main/guides/envvars) in your Remix app. These are made available:
   *
   * 1. In `remix build`, they are loaded into `process.env`.
   * 2. Locally while running `sst dev remix dev`.
   *
   * :::tip
   * You can also `link` resources to your Remix app and access them in a type-safe way with the [SDK](/docs/reference/sdk/). We recommend linking since it's more secure.
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
   * [Link resources](/docs/linking/) to your Remix app. This will:
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
}

/**
 * The `Remix` component lets you deploy a [Remix](https://remix.run) app to AWS.
 *
 * @example
 *
 * #### Minimal example
 *
 * Deploy a Remix app that's in the project root.
 *
 * ```js
 * new sst.aws.Remix("MyWeb");
 * ```
 *
 * #### Change the path
 *
 * Deploys the Remix app in the `my-remix-app/` directory.
 *
 * ```js {2}
 * new sst.aws.Remix("MyWeb", {
 *   path: "my-remix-app/"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Remix app.
 *
 * ```js {2}
 * new sst.aws.Remix("MyWeb", {
 *   domain: "my-app.com"
 * });
 * ```
 *
 * #### Redirect www to apex domain
 *
 * Redirect `www.my-app.com` to `my-app.com`.
 *
 * ```js {4}
 * new sst.aws.Remix("MyWeb", {
 *   domain: {
 *     name: "my-app.com",
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
 * const bucket = new sst.aws.Bucket("MyBucket");
 *
 * new sst.aws.Remix("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * You can use the [SDK](/docs/reference/sdk/) to access the linked resources
 * in your Remix app.
 *
 * ```ts title="app/root.tsx"
 * import { Resource } from "sst";
 *
 * console.log(Resource.MyBucket.name);
 * ```
 */
export class NextJs extends Component implements Link.Linkable {
  private assets: Kv;
  private router: Output<Worker>;
  private middleware: Output<Worker>;
  private servers: Output<Record<string, Function>>;
  private cacheBucket: Bucket;

  constructor(
    name: string,
    args: NextArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;
    const buildCommand = normalizeBuildCommand(args.buildCommand);
    const region = normalizeRegion();
    const { sitePath } = prepare(args);
    const storage = createKvStorage(parent, name, args);
    const bucket = new Bucket(`${name}S3Cache`, {}, { parent });
    const outputPath = buildApp(name, args, sitePath, buildCommand);
    
    const { openNextOutput, prerenderManifest } = loadBuildOutput();
    const revalidationQueue = createRevalidationQueue();
    const revalidationTable = createRevalidationTable();
    createRevalidationTableSeeder();
    const servers = createServersLambda();
    const middlewareArgs = createMiddleware();
    const plan = buildPlan();
    uploadCache();
    const { router, server: middleware } = createRouter(
      parent,
      name,
      args,
      outputPath,
      storage,
      plan,
    );


    this.assets = storage;
    this.router = router;
    this.middleware = middleware;
    this.servers = servers;
    this.cacheBucket = bucket;
    if (!$dev) {
      Hint.register(this.urn, this.url as Output<string>);
    }
    this.registerOutputs({
      _metadata: {
        mode: $dev ? "placeholder" : "deployed",
        path: sitePath,
        url: this.url,
      },
    });


    function loadBuildOutput() {
      const openNextOutput = ($dev ? loadOpenNextOutputPlaceholder(outputPath) : loadOpenNextOutput(outputPath))as ReturnType<typeof loadOpenNextOutput>
      return {
        openNextOutput,
        prerenderManifest: loadPrerenderManifest(outputPath),
      };
    }

    function normalizeRegion() {
      return aws.getRegionOutput(undefined, { provider: opts?.provider }).name;
    }

    function createRevalidationQueue() {
      return all([outputPath, openNextOutput]).apply(
        ([outputPath, openNextOutput]) => {
          if (openNextOutput.additionalProps?.disableIncrementalCache) return;

          const revalidationFunction =
            openNextOutput.additionalProps?.revalidationFunction;
          if (!revalidationFunction) return;

          const queue = new Queue(
            `${name}RevalidationEvents`,
            {
              fifo: true,
              transform: {
                queue: (args) => {
                  args.receiveWaitTimeSeconds = 20;
                },
              },
            },
            { parent },
          );
          queue.subscribe(
            {
              description: `${name} ISR revalidator`,
              handler: revalidationFunction.handler,
              bundle: path.join(outputPath, revalidationFunction.bundle),
              runtime: "nodejs20.x",
              timeout: "30 seconds",
              permissions: [
                {
                  actions: [
                    "sqs:ChangeMessageVisibility",
                    "sqs:DeleteMessage",
                    "sqs:GetQueueAttributes",
                    "sqs:GetQueueUrl",
                    "sqs:ReceiveMessage",
                  ],
                  resources: [queue.arn],
                },
              ],
              live: false,
              _ignoreCodeChanges: $dev,
              _skipMetadata: true,
            },
            {
              transform: {
                eventSourceMapping: (args) => {
                  args.batchSize = 5;
                },
              },
            },
            { parent },
          );
          return queue;
        },
      );
    }

    function createRevalidationTable() {
      return openNextOutput.apply((openNextOutput) => {
        if (openNextOutput.additionalProps?.disableTagCache) return;

        return new aws.dynamodb.Table(
          `${name}RevalidationTable`,
          {
            attributes: [
              { name: "tag", type: "S" },
              { name: "path", type: "S" },
              { name: "revalidatedAt", type: "N" },
            ],
            hashKey: "tag",
            rangeKey: "path",
            pointInTimeRecovery: {
              enabled: true,
            },
            billingMode: "PAY_PER_REQUEST",
            globalSecondaryIndexes: [
              {
                name: "revalidate",
                hashKey: "path",
                rangeKey: "revalidatedAt",
                projectionType: "ALL",
              },
            ],
          },
          { parent },
        );
      });
    }

    function createRevalidationTableSeeder() {
      return all([
        revalidationTable,
        outputPath,
        openNextOutput,
        prerenderManifest,
      ]).apply(
        ([
          revalidationTable,
          outputPath,
          openNextOutput,
          prerenderManifest,
        ]) => {
          if (openNextOutput.additionalProps?.disableTagCache) return;
          if (!openNextOutput.additionalProps?.initializationFunction) return;

          // Provision 128MB of memory for every 4,000 prerendered routes,
          // 1GB per 40,000, up to 10GB. This tends to use ~70% of the memory
          // provisioned when testing.
          const prerenderedRouteCount = Object.keys(
            prerenderManifest?.routes ?? {},
          ).length;
          const seedFn = new Function(
            `${name}RevalidationSeeder`,
            {
              description: `${name} ISR revalidation data seeder`,
              handler:
                openNextOutput.additionalProps.initializationFunction.handler,
              bundle: path.join(
                outputPath,
                openNextOutput.additionalProps.initializationFunction.bundle,
              ),
              runtime: "nodejs20.x",
              timeout: "900 seconds",
              memory: `${Math.min(
                10240,
                Math.max(128, Math.ceil(prerenderedRouteCount / 4000) * 128),
              )} MB`,
              permissions: [
                {
                  actions: [
                    "dynamodb:BatchWriteItem",
                    "dynamodb:PutItem",
                    "dynamodb:DescribeTable",
                  ],
                  resources: [revalidationTable!.arn],
                },
              ],
              environment: {
                CACHE_DYNAMO_TABLE: revalidationTable!.name,
              },
              live: false,
              _ignoreCodeChanges: $dev,
              _skipMetadata: true,
            },
            { parent },
          );
          new aws.lambda.Invocation(
            `${name}RevalidationSeed`,
            {
              functionName: seedFn.nodes.function.name,
              triggers: {
                version: Date.now().toString(),
              },
              input: JSON.stringify({
                RequestType: "Create",
              }),
            },
            { parent, ignoreChanges: $dev ? ["*"] : undefined },
          );
        },
      );
    }

    function buildPlan() {
      return all([outputPath, openNextOutput, middlewareArgs]).apply(
        ([outputPath, openNextOutput, middlewareArgs]) => {
          return validatePlan({
            server: middlewareArgs,
            assets: {
              assetsPrefix: '_assets',
              copy: openNextOutput.origins.s3.copy.filter(copy => copy.to !== "_cache"),
            },
            routes: [
              {
                regex: pathToRegexp("_next/data(.*)").source,
                origin: "server" as const,
              },
              {
                regex: pathToRegexp("_next/image(.*)").source,
                origin: "server" as const,
              },
              ...openNextOutput.behaviors.filter(b => b.origin === 's3').map(b => ({
                regex: pathToRegexp(b.pattern.replace('*', '(.*)')).source,
                origin: "assets" as const,
              })),
              {
                regex: pathToRegexp("(.*)").source,
                origin: "server" as const,
              },
            ],
          });
        },
      );
    }

    function createServersLambda() : Output<Record<string, Function>> {
      return all([
        outputPath, 
        openNextOutput,
        [bucket.arn, bucket.name],
        revalidationQueue.apply((q) => ({ url: q?.url, arn: q?.arn })),
        revalidationTable.apply((t) => ({ name: t?.name, arn: t?.arn })),
        region
      ]).apply(
        ([
          outputPath, 
          openNextOutput,
          [bucketArn, bucketName],
          { url: revalidationQueueUrl, arn: revalidationQueueArn },
          { name: revalidationTableName, arn: revalidationTableArn },
          region
        ]) => {
          const serversOutput = Object.entries(openNextOutput.origins).filter(([_, origin]) => origin.type === "function") as [string, OpenNextServerFunctionOrigin][];
          const defaultFunctionProps = {
            runtime: "nodejs20.x" as const,
            environment: {
              CACHE_BUCKET_NAME: bucketName,
              CACHE_BUCKET_KEY_PREFIX: "_cache",
              CACHE_BUCKET_REGION: region,
              ...(revalidationQueueUrl && {
                REVALIDATION_QUEUE_URL: revalidationQueueUrl,
                REVALIDATION_QUEUE_REGION: region,
              }),
              ...(revalidationTableName && {
                CACHE_DYNAMO_TABLE: revalidationTableName,
              }),
            },
            permissions: [
              // access to the cache data
              {
                actions: ["s3:GetObject", "s3:PutObject"],
                resources: [`${bucketArn}/*`],
              },
              ...(revalidationQueueArn
                ? [
                    {
                      actions: [
                        "sqs:SendMessage",
                        "sqs:GetQueueAttributes",
                        "sqs:GetQueueUrl",
                      ],
                      resources: [revalidationQueueArn],
                    },
                  ]
                : []),
              ...(revalidationTableArn
                ? [
                    {
                      actions: [
                        "dynamodb:BatchGetItem",
                        "dynamodb:GetRecords",
                        "dynamodb:GetShardIterator",
                        "dynamodb:Query",
                        "dynamodb:GetItem",
                        "dynamodb:Scan",
                        "dynamodb:ConditionCheckItem",
                        "dynamodb:BatchWriteItem",
                        "dynamodb:PutItem",
                        "dynamodb:UpdateItem",
                        "dynamodb:DeleteItem",
                        "dynamodb:DescribeTable",
                      ],
                      resources: [
                        revalidationTableArn,
                        `${revalidationTableArn}/*`,
                      ],
                    },
                  ]
                : []),
            ],
          };
          return serversOutput.reduce((acc, [_name, origin]) => {
            acc[_name] = new Function(
              `${name}${_name}Server`,
              {
                description: `${_name} server function`,
                handler: origin.handler,
                bundle: path.join(outputPath, origin.bundle),
                streaming: origin.streaming,
                url: true,
                live: false,
                ...defaultFunctionProps,
              },
              { parent },
            );
            return acc;
          }, {} as Record<string, Function>);
        })
    }

    function createMiddleware() : Output<WorkerArgs> {
      return all([outputPath, openNextOutput]).apply(
        ([outputPath, openNextOutput]) => {

          const openNextOrigin = servers.apply((origins) : Record<string, {
            host: Output<string>,
            protocol: string,
          }> => {
            const r = Object.entries(origins).map(([key, value]) => {
              return [key, {
                  host: value.url.apply(url => new URL(url).hostname),
                  protocol: "https",
                }
                ]
            })
            return Object.fromEntries(r)
          })

          const nodeBuiltInModulesPlugin: Plugin = {
            name: "node:built-in:modules",
            setup(build) {
              build.onResolve({ filter: /^(util|stream)$/ }, ({ kind, path }) => {
                // this plugin converts `require("node:*")` calls, those are the only ones that
                // need updating (esm imports to "node:*" are totally valid), so here we tag with the
                // node-buffer namespace only imports that are require calls
                return kind === "require-call"
                  ? { path, namespace: "node-built-in-modules" }
                  : undefined;
              });
    
              // we convert the imports we tagged with the node-built-in-modules namespace so that instead of `require("node:*")`
              // they import from `export * from "node:*";`
              build.onLoad(
                { filter: /.*/, namespace: "node-built-in-modules" },
                ({ path }) => {
                  return {
                    contents: `export * from 'node:${path}'`,
                    loader: "js",
                  };
                },
              );
            },
          };

          return {
            handler: path.join(outputPath, openNextOutput.edgeFunctions.middleware!.bundle, 'handler.mjs'),
            environment: {
              OPEN_NEXT_ORIGIN: jsonStringify(openNextOrigin)
            },
            build: {
              esbuild: {
                resolveExtensions: [".tsx",".ts",".jsx",".js",".mjs",".css",".json"],
                external: ['./KVCache'],
                plugins: [nodeBuiltInModulesPlugin],
              }
            }
          };
        },
      );
    
    }

    function uploadCache() {
      return all([openNextOutput, outputPath]).apply(async ([openNextOutput, outputPath]) => {

        const bucketFiles: BucketFile[] = [];

        const copy = openNextOutput.origins.s3.copy.find((copy) => copy.to === "_cache");
        if(!copy) return;

        // Build fileOptions
        const fileOptions: BaseSiteFileOptions[] = [
          // unversioned files
          {
            files: "**",
            cacheControl: 'private, no-cache, no-store, must-revalidate',
          },
        ];

        // Upload files based on fileOptions
        const filesUploaded: string[] = [];
        for (const fileOption of fileOptions.reverse()) {
          const files = globSync(fileOption.files, {
            cwd: path.resolve(outputPath, copy.from),
            nodir: true,
            dot: true,
            ignore: fileOption.ignore,
          }).filter((file) => !filesUploaded.includes(file));

          bucketFiles.push(
            ...(await Promise.all(
              files.map(async (file) => {
                const source = path.resolve(outputPath, copy.from, file);
                const content = await fs.promises.readFile(source);
                const hash = crypto
                  .createHash("sha256")
                  .update(content)
                  .digest("hex");
                return {
                  source,
                  key: path.posix.join(copy.to, file),
                  hash,
                  cacheControl: fileOption.cacheControl,
                  contentType: getContentType(file, "UTF-8"),
                };
              }),
            )),
          );
          filesUploaded.push(...files);
            
        }

        return new BucketFiles(
          `${name}AssetFiles`,
          {
            bucketName: bucket.name,
            files: bucketFiles,
          },
          { parent, ignoreChanges: $dev ? ["*"] : undefined },
        );
      });
    }

  }

  /**
   * The URL of the Remix app.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated CloudFront URL.
   */
  public get url() {
    return this.router.url;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The cloudfare worker that routes requests to the correct origin.
       */
      middleware: this.middleware,
      /**
       * The serverless functions that serve the Next app.
       */
      servers: this.servers,
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
const __pulumiType = "sst:cloudflare:Next";
// @ts-expect-error
NextJs.__pulumiType = __pulumiType;

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { globSync } from "glob";
import {
  ComponentResourceOptions,
  Output,
  all,
  asset,
  interpolate,
  output,
} from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { Size, toMBs } from "./util/size.js";
import { Function } from "./function.js";
import {
  EdgeFunctionConfig,
  FunctionOriginConfig,
  Plan,
  SsrSiteArgs,
  buildApp,
  createBucket,
  createServersAndDistribution,
  prepare,
  useCloudFrontFunctionHostHeaderInjection,
  validatePlan,
} from "./ssr-site.js";
import { Cdn } from "./cdn.js";
import { bootstrap } from "./helpers/aws/bootstrap.js";
import { Bucket } from "./bucket.js";
import { Component, transform } from "./component.js";
import { sanitizeToPascalCase } from "./helpers/naming.js";
import { Hint } from "./hint.js";
import { VisibleError } from "./error.js";

const LAYER_VERSION = "2";
const DEFAULT_OPEN_NEXT_VERSION = "3.0.0-rc.3";
const DEFAULT_CACHE_POLICY_ALLOWED_HEADERS = [
  "accept",
  "x-prerender-revalidate",
  "rsc",
  "next-router-prefetch",
  "next-router-state-tree",
  "next-url",
];

type BaseFunction = {
  handler: string;
  bundle: string;
};

type OpenNextFunctionOrigin = {
  type: "function";
  streaming?: boolean;
  wrapper: string;
  converter: string;
} & BaseFunction;

type OpenNextServerFunctionOrigin = OpenNextFunctionOrigin & {
  queue: string;
  incrementalCache: string;
  tagCache: string;
};

type OpenNextImageOptimizationOrigin = OpenNextFunctionOrigin & {
  imageLoader: string;
};

type OpenNextS3Origin = {
  type: "s3";
  originPath: string;
  copy: {
    from: string;
    to: string;
    cached: boolean;
    versionedSubDir?: string;
  }[];
};

interface OpenNextOutput {
  edgeFunctions: {
    [key: string]: BaseFunction;
  } & {
    middleware?: BaseFunction & { pathResolver: string };
  };
  origins: {
    s3: OpenNextS3Origin;
    default: OpenNextServerFunctionOrigin;
    imageOptimizer: OpenNextImageOptimizationOrigin;
  } & {
    [key: string]: OpenNextServerFunctionOrigin | OpenNextS3Origin;
  };
  behaviors: {
    pattern: string;
    origin?: string;
    edgeFunction?: string;
  }[];
  additionalProps?: {
    disableIncrementalCache?: boolean;
    disableTagCache?: boolean;
    initializationFunction?: BaseFunction;
    warmer?: BaseFunction;
    revalidationFunction?: BaseFunction;
  };
}

export interface NextjsArgs extends SsrSiteArgs {
  /**
   * OpenNext version for building the Next.js site.
   * @default Latest OpenNext version
   * @example
   * ```js
   * openNextVersion: "3.0.0-rc.3",
   * ```
   */
  openNextVersion?: string;
  /**
   * How the logs are stored in CloudWatch
   * - "combined" - Logs from all routes are stored in the same log group.
   * - "per-route" - Logs from each route are stored in a separate log group. Doesn't work right now
   * @default "per-route"
   * @example
   * ```js
   * logging: "combined",
   * ```
   */
  logging?: "combined" | "per-route";
  imageOptimization?: {
    /**
     * The amount of memory in MB allocated for image optimization function.
     * @default 1024 MB
     * @example
     * ```js
     * imageOptimization: {
     *   memory: "512 MB",
     * }
     * ```
     */
    memory?: Size;
  };
}

/**
 * The `Nextjs` construct is a higher level CDK construct that makes it easy to create a Next.js app.
 * @example
 * Deploys a Next.js app in the `my-next-app` directory.
 *
 * ```js
 * new Nextjs("Web", {
 *   path: "my-next-app/",
 * });
 * ```
 */
export class Nextjs extends Component {
  private doNotDeploy: Output<boolean>;
  private cdn: Cdn;
  private assets: Bucket;
  private server?: Function;
  //private serverFunctionForDev?: Function;

  constructor(
    name: string,
    args?: NextjsArgs,
    opts?: ComponentResourceOptions
  ) {
    super("sst:sst:Nextjs", name, args, opts);

    const parent = this;
    const logging = normalizeLogging();
    const buildCommand = normalizeBuildCommand();
    buildCommand.apply((buildCommand) => console.log(buildCommand));
    const { sitePath, doNotDeploy } = prepare(args || {});
    //if (doNotDeploy) {
    //  // @ts-expect-error
    //  this.bucket = this.distribution = null;
    //  this.serverFunctionForDev = createServerFunctionForDev();
    //  app.registerTypes(this);
    //  return;
    //}

    let _routes: Output<
      ({
        route: string;
        logGroupPath: string;
        sourcemapPath?: string;
        sourcemapKey?: string;
      } & ({ regexMatch: string } | { prefixMatch: string }))[]
    >;
    let routesManifest: Output<{
      dynamicRoutes: { page: string; regex: string }[];
      staticRoutes: { page: string; regex: string }[];
      dataRoutes?: { page: string; dataRouteRegex: string }[];
    }>;
    let appPathRoutesManifest: Output<Record<string, string>>;
    let appPathsManifest: Output<Record<string, string>>;
    let pagesManifest: Output<Record<string, string>>;
    let prerenderManifest: Output<{
      version: number;
      routes: Record<string, unknown>;
    }>;

    const outputPath = buildApp(name, args || {}, sitePath, buildCommand);
    const { access, bucket } = createBucket(parent, name);
    const openNextOutput = loadOpenNextOutput();
    const revalidationQueue = createRevalidationQueue();
    const revalidationTable = createRevalidationTable();

    const plan = buildPlan(bucket);
    // TODO set dependency
    // TODO ensure sourcemaps are removed in function code
    // We don't need to remove source maps in V3
    // removeSourcemaps();

    const { distribution, ssrFunctions, edgeFunctions } =
      createServersAndDistribution(
        parent,
        name,
        args || {},
        outputPath,
        access,
        bucket,
        plan
      );
    const serverFunction = ssrFunctions[0] ?? Object.values(edgeFunctions)[0];

    handleMissingSourcemap(); // TODO implement

    if (isPerRouteLoggingEnabled()) {
      //disableDefaultLogging();
      uploadSourcemaps();
    }

    this.doNotDeploy = doNotDeploy;
    this.assets = bucket;
    this.cdn = distribution as unknown as Cdn;
    this.server = serverFunction as unknown as Function;
    Hint.register(
      this.urn,
      all([this.cdn.domainUrl, this.cdn.url]).apply(
        ([domainUrl, url]) => domainUrl ?? url
      )
    );

    //app.registerTypes(this);

    function normalizeLogging() {
      return output(args?.logging).apply((logging) => logging ?? "per-route");
    }

    function normalizeBuildCommand() {
      return all([args?.buildCommand]).apply(
        ([buildCommand]) =>
          buildCommand ??
          [
            "npx",
            "--yes",
            `open-next@${args?.openNextVersion ?? DEFAULT_OPEN_NEXT_VERSION}`,
            "build",
          ].join(" ")
      );
    }

    function loadOpenNextOutput() {
      return outputPath.apply((outputPath) => {
        const openNextOutputPath = path.join(
          outputPath,
          ".open-next",
          "open-next.output.json"
        );
        if (!fs.existsSync(openNextOutputPath)) {
          throw new VisibleError(
            `Failed to load open-next.output.json from "${openNextOutputPath}".`
          );
        }
        const content = fs.readFileSync(openNextOutputPath).toString();
        return JSON.parse(content) as OpenNextOutput;
      });
    }

    function buildPlan(bucket: Bucket) {
      return all([
        outputPath,
        openNextOutput,
        $app.providers?.aws?.region!,
        args?.imageOptimization,
        bucket.name,
        useRoutes(),
        revalidationQueue.apply((q) => ({ url: q?.url, arn: q?.arn })),
        revalidationTable.apply((t) => ({ name: t?.name, arn: t?.arn })),
      ]).apply(
        ([
          outputPath,
          openNextOutput,
          region,
          imageOptimization,
          bucketName,
          routes,
          { url: revalidationQueueUrl, arn: revalidationQueueArn },
          { name: revalidationTableName, arn: revalidationTableArn },
        ]) => {
          const defaultFunctionProps = {
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
            policies: [
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
            layers: isPerRouteLoggingEnabled()
              ? [
                  `arn:aws:lambda:${$app.providers?.aws
                    ?.region!}:226609089145:layer:sst-extension-arm64:${LAYER_VERSION}`,
                  //              cdk?.server?.architecture?.name === Architecture.X86_64.name
                  //                ? `arn:aws:lambda:${stack.region}:226609089145:layer:sst-extension-amd64:${LAYER_VERSION}`
                  //                : `arn:aws:lambda:${stack.region}:226609089145:layer:sst-extension-arm64:${LAYER_VERSION}`
                ]
              : undefined,
          };

          return validatePlan(
            transform(args?.transform?.plan, {
              edge: false,
              cloudFrontFunctions: {
                serverCfFunction: {
                  injections: [useCloudFrontFunctionHostHeaderInjection()],
                },
              },
              edgeFunctions: Object.fromEntries(
                Object.entries(openNextOutput.edgeFunctions).map(
                  ([key, value]) => [
                    key,
                    {
                      function: {
                        description: "Next.js edge server",
                        bundle: path.join(outputPath, value.bundle),
                        handler: value.handler,
                        ...defaultFunctionProps,
                      },
                    },
                  ]
                )
              ),
              origins: Object.fromEntries(
                Object.entries(openNextOutput.origins).map(([key, value]) => {
                  if (key === "s3") {
                    return [key, value];
                  }
                  if (key === "imageOptimizer") {
                    value = value as OpenNextImageOptimizationOrigin;
                    return [
                      key,
                      {
                        type: "image-optimization-function",
                        function: {
                          description: "Next.js image optimizer",
                          handler: value.handler,
                          bundle: path.join(outputPath, value.bundle),
                          runtime: "nodejs18.x",
                          architecture: "arm64",
                          environment: {
                            BUCKET_NAME: bucketName,
                            BUCKET_KEY_PREFIX: "_assets",
                          },
                          memory: imageOptimization?.memory ?? "1536 MB",
                        },
                      },
                    ];
                  }
                  value = value as OpenNextServerFunctionOrigin;
                  return [
                    key,
                    {
                      type: "function",
                      function: {
                        description: "Next.js server",
                        bundle: path.join(outputPath, value.bundle),
                        handler: value.handler,
                        ...defaultFunctionProps,
                      },
                      streaming: value.streaming,
                    },
                  ];
                })
              ),
              behaviors: openNextOutput.behaviors.map((behavior) => {
                return {
                  pattern:
                    behavior.pattern === "*" ? undefined : behavior.pattern,
                  origin: behavior.origin ?? "",
                  cacheType:
                    behavior.origin === "s3" ? "static" : ("server" as const),
                  cfFunction: "serverCfFunction",
                  edgeFunction: behavior.edgeFunction ?? "",
                };
              }),
              serverCachePolicy: {
                allowedHeaders: DEFAULT_CACHE_POLICY_ALLOWED_HEADERS,
              },
              buildId: fs
                .readFileSync(path.join(outputPath, ".next/BUILD_ID"))
                .toString(),
            })
          );

          function useServerFunctionPerRouteLoggingInjection() {
            return `
if (event.rawPath) {
  const routeData = ${JSON.stringify(
    // @ts-expect-error
    routes.map(({ regexMatch, prefixMatch, logGroupPath }) => ({
      regex: regexMatch,
      prefix: prefixMatch,
      logGroupPath,
    }))
  )}.find(({ regex, prefix }) => {
    if (regex) return event.rawPath.match(new RegExp(regex));
    if (prefix) return event.rawPath === prefix || (event.rawPath === prefix + "/");
    return false;
  });
  if (routeData) {
    console.log("::sst::" + JSON.stringify({
      action:"log.split",
      properties: {
        logGroupName:"/sst/lambda/" + context.functionName + routeData.logGroupPath,
      },
    }));
  }
}`;
          }
        }
      );
    }

    function createRevalidationQueue() {
      return openNextOutput.apply((openNextOutput) => {
        if (openNextOutput.additionalProps?.disableIncrementalCache) return;

        const queue = new aws.sqs.Queue(
          `${name}RevalidationQueue`,
          {
            fifoQueue: true,
            receiveWaitTimeSeconds: 20,
          },
          { parent }
        );
        const consumer = new Function(
          `${name}Revalidator`,
          {
            description: "Next.js revalidator",
            handler: "index.handler",
            bundle: outputPath.apply((outputPath) =>
              path.join(outputPath, ".open-next", "revalidation-function")
            ),
            runtime: "nodejs18.x",
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
          },
          { parent }
        );
        new aws.lambda.EventSourceMapping(
          `${name}RevalidatorEventSource`,
          {
            functionName: consumer.nodes.function.name,
            eventSourceArn: queue.arn,
            batchSize: 5,
          },
          { parent }
        );
        return queue;
      });
    }

    function createRevalidationTable() {
      return all([openNextOutput, outputPath, usePrerenderManifest()]).apply(
        ([openNextOutput, outputPath, prerenderManifest]) => {
          if (openNextOutput.additionalProps?.disableTagCache) return;

          const table = new aws.dynamodb.Table(
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
            { parent }
          );

          const dynamodbProviderPath = path.join(
            outputPath,
            ".open-next",
            "dynamodb-provider"
          );
          if (fs.existsSync(dynamodbProviderPath)) {
            // Provision 128MB of memory for every 4,000 prerendered routes,
            // 1GB per 40,000, up to 10GB. This tends to use ~70% of the memory
            // provisioned when testing.
            const prerenderedRouteCount = Object.keys(
              prerenderManifest?.routes ?? {}
            ).length;
            const seedFn = new Function(
              `${name}RevalidationSeeder`,
              {
                description: "Next.js revalidation data seeder",
                handler: "index.handler",
                bundle: dynamodbProviderPath,
                runtime: "nodejs18.x",
                timeout: "900 seconds",
                memory: `${Math.min(
                  10240,
                  Math.max(128, Math.ceil(prerenderedRouteCount / 4000) * 128)
                )} MB`,
                permissions: [
                  {
                    actions: [
                      "dynamodb:BatchWriteItem",
                      "dynamodb:PutItem",
                      "dynamodb:DescribeTable",
                    ],
                    resources: [table.arn],
                  },
                ],
                environment: {
                  CACHE_DYNAMO_TABLE: table.name,
                },
              },
              { parent }
            );
            new aws.lambda.Invocation(
              `${name}RevalidationSeed`,
              {
                functionName: seedFn.nodes.function.name,
                triggers: {
                  version: Date.now().toString(),
                },
                input: JSON.stringify({}),
              },
              { parent }
            );
          }
          return table;
        }
      );
    }

    function removeSourcemaps() {
      return outputPath.apply((outputPath) => {
        const files = globSync("**/*.js.map", {
          cwd: path.join(outputPath, ".open-next", "server-function"),
          nodir: true,
          dot: true,
        });
        for (const file of files) {
          fs.rmSync(
            path.join(outputPath, ".open-next", "server-function", file)
          );
        }
      });
    }

    function useRoutes() {
      if (_routes) return _routes;

      _routes = all([
        outputPath,
        useRoutesManifest(),
        useAppPathRoutesManifest(),
        useAppPathsManifest(),
      ]).apply(
        ([
          outputPath,
          routesManifest,
          appPathRoutesManifest,
          appPathsManifest,
        ]) => {
          const dynamicAndStaticRoutes = [
            ...routesManifest.dynamicRoutes,
            ...routesManifest.staticRoutes,
          ].map(({ page, regex }) => {
            const cwRoute = buildCloudWatchRouteName(page);
            const cwHash = buildCloudWatchRouteHash(page);
            const sourcemapPath =
              getSourcemapForAppRoute(page) || getSourcemapForPagesRoute(page);
            return {
              route: page,
              regexMatch: regex,
              logGroupPath: `/${cwHash}${cwRoute}`,
              sourcemapPath: sourcemapPath,
              sourcemapKey: cwHash,
            };
          });

          // Some app routes are not in the routes manifest, so we need to add them
          // ie. app/api/route.ts => IS NOT in the routes manifest
          //     app/items/[slug]/route.ts => IS in the routes manifest (dynamicRoutes)
          const appRoutes = Object.values(appPathRoutesManifest)
            .filter(
              (page) =>
                routesManifest.dynamicRoutes.every(
                  (route) => route.page !== page
                ) &&
                routesManifest.staticRoutes.every(
                  (route) => route.page !== page
                )
            )
            .map((page) => {
              const cwRoute = buildCloudWatchRouteName(page);
              const cwHash = buildCloudWatchRouteHash(page);
              const sourcemapPath = getSourcemapForAppRoute(page);
              return {
                route: page,
                prefixMatch: page,
                logGroupPath: `/${cwHash}${cwRoute}`,
                sourcemapPath: sourcemapPath,
                sourcemapKey: cwHash,
              };
            });

          const dataRoutes = (routesManifest.dataRoutes || []).map(
            ({ page, dataRouteRegex }) => {
              const routeDisplayName = page.endsWith("/")
                ? `/_next/data/BUILD_ID${page}index.json`
                : `/_next/data/BUILD_ID${page}.json`;
              const cwRoute = buildCloudWatchRouteName(routeDisplayName);
              const cwHash = buildCloudWatchRouteHash(page);
              return {
                route: routeDisplayName,
                regexMatch: dataRouteRegex,
                logGroupPath: `/${cwHash}${cwRoute}`,
              };
            }
          );

          return [
            ...[...dynamicAndStaticRoutes, ...appRoutes].sort((a, b) =>
              a.route.localeCompare(b.route)
            ),
            ...dataRoutes.sort((a, b) => a.route.localeCompare(b.route)),
          ];

          function getSourcemapForAppRoute(page: string) {
            // Step 1: look up in "appPathRoutesManifest" to find the key with
            //         value equal to the page
            // {
            //   "/_not-found": "/_not-found",
            //   "/about/page": "/about",
            //   "/about/profile/page": "/about/profile",
            //   "/page": "/",
            //   "/favicon.ico/route": "/favicon.ico"
            // }
            const appPathRoute = Object.keys(appPathRoutesManifest).find(
              (key) => appPathRoutesManifest[key] === page
            );
            if (!appPathRoute) return;

            // Step 2: look up in "appPathsManifest" to find the file with key equal
            //         to the page
            // {
            //   "/_not-found": "app/_not-found.js",
            //   "/about/page": "app/about/page.js",
            //   "/about/profile/page": "app/about/profile/page.js",
            //   "/page": "app/page.js",
            //   "/favicon.ico/route": "app/favicon.ico/route.js"
            // }
            const filePath = appPathsManifest[appPathRoute];
            if (!filePath) return;

            // Step 3: check the .map file exists
            const sourcemapPath = path.join(
              outputPath,
              ".next",
              "server",
              `${filePath}.map`
            );
            if (!fs.existsSync(sourcemapPath)) return;

            return sourcemapPath;
          }

          function getSourcemapForPagesRoute(page: string) {
            // Step 1: look up in "pathsManifest" to find the file with key equal
            //         to the page
            // {
            //   "/_app": "pages/_app.js",
            //   "/_error": "pages/_error.js",
            //   "/404": "pages/404.html",
            //   "/api/hello": "pages/api/hello.js",
            //   "/api/auth/[...nextauth]": "pages/api/auth/[...nextauth].js",
            //   "/api/next-auth-restricted": "pages/api/next-auth-restricted.js",
            //   "/": "pages/index.js",
            //   "/ssr": "pages/ssr.js"
            // }
            const pagesManifest = usePagesManifest();
            const filePath = pagesManifest[page];
            if (!filePath) return;

            // Step 2: check the .map file exists
            const sourcemapPath = path.join(
              outputPath,
              ".next",
              "server",
              `${filePath}.map`
            );
            if (!fs.existsSync(sourcemapPath)) return;

            return sourcemapPath;
          }
        }
      );

      return _routes;
    }

    function useRoutesManifest() {
      if (routesManifest) return routesManifest;

      return outputPath.apply((outputPath) => {
        try {
          const content = fs
            .readFileSync(path.join(outputPath, ".next/routes-manifest.json"))
            .toString();
          routesManifest = JSON.parse(content);
          return routesManifest!;
        } catch (e) {
          console.error(e);
          throw new VisibleError(
            `Failed to read routes data from ".next/routes-manifest.json" for the "${name}" site.`
          );
        }
      });
    }

    function useAppPathRoutesManifest() {
      // Example
      // {
      //   "/_not-found": "/_not-found",
      //   "/page": "/",
      //   "/favicon.ico/route": "/favicon.ico",
      //   "/api/route": "/api",                    <- app/api/route.js
      //   "/api/sub/route": "/api/sub",            <- app/api/sub/route.js
      //   "/items/[slug]/route": "/items/[slug]"   <- app/items/[slug]/route.js
      // }

      if (appPathRoutesManifest) return appPathRoutesManifest;

      appPathRoutesManifest = outputPath.apply((outputPath) => {
        try {
          const content = fs
            .readFileSync(
              path.join(outputPath, ".next/app-path-routes-manifest.json")
            )
            .toString();
          return JSON.parse(content) as Record<string, string>;
        } catch (e) {
          return {};
        }
      });
      return appPathRoutesManifest;
    }

    function useAppPathsManifest() {
      if (appPathsManifest) return appPathsManifest;

      appPathsManifest = outputPath.apply((outputPath) => {
        try {
          const content = fs
            .readFileSync(
              path.join(outputPath, ".next/server/app-paths-manifest.json")
            )
            .toString();
          return JSON.parse(content) as Record<string, string>;
        } catch (e) {
          return {};
        }
      });
      return appPathsManifest!;
    }

    function usePagesManifest() {
      if (pagesManifest) return pagesManifest;

      pagesManifest = outputPath.apply((outputPath) => {
        try {
          const content = fs
            .readFileSync(
              path.join(outputPath, ".next/server/pages-manifest.json")
            )
            .toString();
          return JSON.parse(content) as Record<string, string>;
        } catch (e) {
          return {};
        }
      });
      return pagesManifest;
    }

    function usePrerenderManifest() {
      if (prerenderManifest) return prerenderManifest;

      return outputPath.apply((outputPath) => {
        try {
          const content = fs
            .readFileSync(
              path.join(outputPath, ".next/prerender-manifest.json")
            )
            .toString();
          prerenderManifest = JSON.parse(content);
          return prerenderManifest!;
        } catch (e) {
          console.debug("Failed to load prerender-manifest.json", e);
        }
      });
    }

    function isPerRouteLoggingEnabled() {
      return !doNotDeploy && args?.logging === "per-route";
    }

    function handleMissingSourcemap() {
      //if (doNotDeploy || this.args.edge) return;
      //const hasMissingSourcemap = useRoutes().every(
      //  ({ sourcemapPath, sourcemapKey }) => !sourcemapPath || !sourcemapKey
      //);
      //if (!hasMissingSourcemap) return;
      //// TODO set correct missing sourcemap value
      ////(this.serverFunction as SsrFunction)._overrideMissingSourcemap();
    }

    function disableDefaultLogging() {
      if (!serverFunction) return;

      const policy = new aws.iam.Policy(
        `${name}DisableLoggingPolicy`,
        {
          policy: interpolate`{
            "Version": "2012-10-17",
            "Statement": [
              {
                "Actions": [
                  "logs:CreateLogGroup",
                  "logs:CreateLogStream",
                  "logs:PutLogEvents",
                ],
                "Effect": "Deny",
                "Resources": [
                  "${serverFunction.nodes.logGroup.logGroupArn}",
                  "${serverFunction.nodes.logGroup.logGroupArn}:*",
                ],
              }
            ]
          }`,
        },
        { parent }
      );
      new aws.iam.RolePolicyAttachment(
        `${name}DisableLoggingPolicyAttachment`,
        {
          policyArn: policy.arn,
          role: serverFunction.nodes.function.role,
        },
        { parent }
      );
    }

    function uploadSourcemaps() {
      if (!serverFunction) return;

      useRoutes().apply((routes) => {
        routes.forEach(({ sourcemapPath, sourcemapKey }) => {
          if (!sourcemapPath || !sourcemapKey) return;

          new aws.s3.BucketObjectv2(
            `${name}Sourcemap${sanitizeToPascalCase(sourcemapKey)}`,
            {
              bucket: output($app.providers?.aws?.region!).apply((region) =>
                bootstrap.forRegion(region)
              ),
              source: new asset.FileAsset(sourcemapPath),
              key: serverFunction!.nodes.function.arn.apply((arn) =>
                path.posix.join("sourcemaps", arn, sourcemapKey)
              ),
            },
            { parent, retainOnDelete: true }
          );
        });
      });
    }

    function buildCloudWatchRouteName(route: string) {
      return route.replace(/[^a-zA-Z0-9_\-/.#]/g, "");
    }

    function buildCloudWatchRouteHash(route: string) {
      const hash = crypto.createHash("sha256");
      hash.update(route);
      return hash.digest("hex").substring(0, 8);
    }
  }

  /**
   * The CloudFront URL of the website.
   */
  public get url() {
    //if (this.doNotDeploy) return this.props.dev?.url;
    return this.cdn.url;
  }

  /**
   * If the custom domain is enabled, this is the URL of the website with the
   * custom domain.
   */
  public get domainUrl() {
    if (this.doNotDeploy) return;

    return this.cdn.domainUrl;
  }

  /**
   * The internally created CDK resources.
   */
  public get nodes() {
    if (this.doNotDeploy) return;

    return {
      server: this.server,
      assets: this.assets,
      cdn: this.cdn,
    };
  }

  /**
   * Attaches the given list of permissions to allow the server side
   * rendering framework to access other AWS resources.
   *
   * @example
   * ```js
   * site.attachPermissions(["sns"]);
   * ```
   */
  public attachPermissions(): void {
    //public attachPermissions(permissions: Permissions): void {
    //  const server = this.server || this.serverFunctionForDev;
    //  attachPermissionsToRole(server?.role as Role, permissions);
    //}
  }

  ///** @internal */
  public getFunctionBinding() {
    // TODO implement binding
    //public getFunctionBinding(): FunctionBindingProps {
    //  const app = this.node.root as App;
    //  return {
    //    clientPackage: "site",
    //    variables: {
    //      url: this.doNotDeploy
    //        ? {
    //            type: "plain",
    //            value: this.props.dev?.url ?? "localhost",
    //          }
    //        : {
    //            // Do not set real value b/c we don't want to make the Lambda function
    //            // depend on the Site. B/c often the site depends on the Api, causing
    //            // a CloudFormation circular dependency if the Api and the Site belong
    //            // to different stacks.
    //            type: "site_url",
    //            value: this.domainUrl || this.url!,
    //          },
    //    },
    //    permissions: {
    //      "ssm:GetParameters": [
    //        `arn:${Stack.of(this).partition}:ssm:${app.region}:${
    //          app.account
    //        }:parameter${getParameterPath(this, "url")}`,
    //      ],
    //    },
    //  };
  }

  /** @internal */
  private getConstructMetadataBase() {
    //  return {
    //    data: {
    //      mode: this.doNotDeploy
    //        ? ("placeholder" as const)
    //        : ("deployed" as const),
    //      path: this.props.path,
    //      runtime: this.props.runtime,
    //      domainUrl: this.domainUrl,
    //      url: this.url,
    //      edge: this.edge,
    //      server: (this.serverFunctionForDev || this.server)
    //        ?.functionArn!,
    //      secrets: (this.props.bind || [])
    //        .filter((c) => c instanceof Secret)
    //        .map((c) => (c as Secret).name),
    //    },
    //  };
  }

  /** @internal */
  public getConstructMetadata() {
    // TODO implement metadata
    //  const metadata = this.getConstructMetadataBase();
    //  return {
    //    ...metadata,
    //    type: "NextjsSite" as const,
    //    data: {
    //      ...metadata.data,
    //      routes: isPerRouteLoggingEnabled()
    //        ? {
    //            logGroupPrefix: `/sst/lambda/${
    //              (this.server as SsrFunction).functionName
    //            }`,
    //            data: this.useRoutes().map(({ route, logGroupPath }) => ({
    //              route,
    //              logGroupPath,
    //            })),
    //          }
    //        : undefined,
    //    },
    //  };
  }
}

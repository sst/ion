import path from "node:path";
import { VisibleError } from "../error";
import fs from "node:fs";
import { Input, Output, all } from "@pulumi/pulumi";

export const DEFAULT_OPEN_NEXT_VERSION = "3.0.6";
export const DEFAULT_CACHE_POLICY_ALLOWED_HEADERS = ["x-open-next-cache-key"];

export type BaseFunction = {
  handler: string;
  bundle: string;
};

export type OpenNextFunctionOrigin = {
  type: "function";
  streaming?: boolean;
  wrapper: string;
  converter: string;
} & BaseFunction;

export type OpenNextServerFunctionOrigin = OpenNextFunctionOrigin & {
  queue: string;
  incrementalCache: string;
  tagCache: string;
};

export type OpenNextImageOptimizationOrigin = OpenNextFunctionOrigin & {
  imageLoader: string;
};

export type OpenNextS3Origin = {
  type: "s3";
  originPath: string;
  copy: {
    from: string;
    to: string;
    cached: boolean;
    versionedSubDir?: string;
  }[];
};

export interface OpenNextOutput {
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

export function loadOpenNextOutput(outputPath: Output<string>) {
  return outputPath.apply((outputPath) => {
    const openNextOutputPath = path.join(
      outputPath,
      ".open-next",
      "open-next.output.json",
    );
    if (!fs.existsSync(openNextOutputPath)) {
      throw new VisibleError(
        `Failed to load open-next.output.json from "${openNextOutputPath}".`,
      );
    }
    const content = fs.readFileSync(openNextOutputPath).toString();
    const json = JSON.parse(content) as OpenNextOutput;
    // Currently open-next.output.json's initializationFunction value
    // is wrong, it is set to ".open-next/initialization-function"
    if (json.additionalProps?.initializationFunction) {
      json.additionalProps.initializationFunction = {
        handler: "index.handler",
        bundle: ".open-next/dynamodb-provider",
      };
    }
    return json;
  });
}

export function loadOpenNextOutputPlaceholder(outputPath: Output<string>) {
  // Configure origins and behaviors based on the Next.js app from quick start
  return outputPath.apply((outputPath) => ({
    edgeFunctions: {},
    origins: {
      s3: {
        type: "s3",
        originPath: "_assets",
        // do not upload anything
        copy: [],
      },
      imageOptimizer: {
        type: "function",
        handler: "index.handler",
        bundle: path.join(
          outputPath,
          ".open-next/image-optimization-function",
        ),
        streaming: false,
      },
      default: {
        type: "function",
        handler: "index.handler",
        bundle: path.join(
          outputPath,
          ".open-next/server-functions/default",
        ),
        streaming: false,
      },
    },
    behaviors: [
      { pattern: "_next/image*", origin: "imageOptimizer" },
      { pattern: "_next/data/*", origin: "default" },
      { pattern: "*", origin: "default" },
      { pattern: "BUILD_ID", origin: "s3" },
      { pattern: "_next/*", origin: "s3" },
      { pattern: "favicon.ico", origin: "s3" },
      { pattern: "next.svg", origin: "s3" },
      { pattern: "vercel.svg", origin: "s3" },
    ],
    additionalProps: {
      // skip creating revalidation queue
      disableIncrementalCache: true,
      // skip creating revalidation table
      disableTagCache: true,
    },
  }));
}

export function loadBuildId(outputPath: Output<string>, name: string) {
  return outputPath.apply((outputPath) => {
    if ($dev) return "mock-build-id";

    try {
      return fs
        .readFileSync(path.join(outputPath, ".next/BUILD_ID"))
        .toString();
    } catch (e) {
      console.error(e);
      throw new VisibleError(
        `Failed to read build id from ".next/BUILD_ID" for the "${name}" site.`,
      );
    }
  });
}

export function loadPrerenderManifest(outputPath: Output<string>) {
  return outputPath.apply((outputPath) => {
    if ($dev) return { version: 0, routes: {} };

    try {
      const content = fs
        .readFileSync(
          path.join(outputPath, ".next/prerender-manifest.json"),
        )
        .toString();
      return JSON.parse(content) as {
        version: number;
        routes: Record<string, unknown>;
      };
    } catch (e) {
      console.debug("Failed to load prerender-manifest.json", e);
    }
  });
}

export interface BaseNextArgs {
  buildCommand?: string;
  openNextVersion?: string;
}

export function normalizeBuildCommand(buildCommand?: Input<string>, openNextVersion?: Input<string>) {
  return all([buildCommand, openNextVersion]).apply(
    ([buildCommand, openNextVersion]) =>
      buildCommand ??
      [
        "OPEN_NEXT_DEBUG=true",
        "npx",
        "--yes",
        `open-next@${openNextVersion ?? DEFAULT_OPEN_NEXT_VERSION}`,
        "build",
      ].join(" "),
  );
}
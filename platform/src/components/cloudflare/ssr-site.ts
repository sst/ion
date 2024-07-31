import path from "path";
import fs from "fs";
import { globSync } from "glob";
import crypto from "crypto";
import { Output, Unwrap, output, all, ComponentResource } from "@pulumi/pulumi";
import { Input } from "../input.js";
import { transform, type Transform } from "../component.js";
import { VisibleError } from "../error.js";
import { BaseSiteFileOptions } from "../base/base-site.js";
import { BaseSsrSiteArgs } from "../base/base-ssr-site.js";
import { Kv, KvArgs } from "./kv.js";
import { Worker, WorkerArgs } from "./worker.js";
import { KvData } from "./providers/kv-data.js";
import { DEFAULT_ACCOUNT_ID } from "./account-id.js";

type Plan = ReturnType<typeof validatePlan>;
export interface SsrSiteArgs extends BaseSsrSiteArgs {
  domain?: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Kv resource used for uploading the assets.
     */
    assets?: Transform<KvArgs>;
  };
}

export function prepare(args: SsrSiteArgs) {
  const sitePath = normalizeSitePath();

  return {
    sitePath,
  };

  function normalizeSitePath() {
    return output(args.path).apply((sitePath) => {
      if (!sitePath) return ".";

      if (!fs.existsSync(sitePath)) {
        throw new VisibleError(`No site found at "${path.resolve(sitePath)}"`);
      }
      return sitePath;
    });
  }
}

export function createKvStorage(
  parent: ComponentResource,
  name: string,
  args: SsrSiteArgs,
) {
  return new Kv(
    ...transform(
      args.transform?.assets,
      `${name}Assets`,
      {},
      {
        parent,
        retainOnDelete: false,
      },
    ),
  );
}

export function createRouter(
  parent: ComponentResource,
  name: string,
  args: SsrSiteArgs,
  outputPath: Output<string>,
  storage: Kv,
  plan: Input<Plan>,
) {
  return all([outputPath, plan]).apply(([outputPath, plan]) => {
    const assetManifest = generateAssetManifest();
    const kvData = uploadAssets();
    const server = createServerWorker();
    const router = createRouterWorker();

    return { server, router };

    function generateAssetManifest() {
      return output(args.assets).apply(async (assets) => {
        // Define content headers
        const versionedFilesTTL = 31536000; // 1 year
        const nonVersionedFilesTTL = 86400; // 1 day

        const manifest = [];

        // Handle each copy source
        for (const copy of plan.assets.copy) {
          // Build fileOptions
          const fileOptions: BaseSiteFileOptions[] = [
            // unversioned files
            {
              files: "**",
              ignore: copy.versionedSubDir
                ? path.posix.join(copy.versionedSubDir, "**")
                : undefined,
              cacheControl:
                assets?.nonVersionedFilesCacheHeader ??
                `public,max-age=0,s-maxage=${nonVersionedFilesTTL},stale-while-revalidate=${nonVersionedFilesTTL}`,
            },
            // versioned files
            ...(copy.versionedSubDir
              ? [
                  {
                    files: path.posix.join(copy.versionedSubDir, "**"),
                    cacheControl:
                      assets?.versionedFilesCacheHeader ??
                      `public,max-age=${versionedFilesTTL},immutable`,
                  },
                ]
              : []),
            ...(assets?.fileOptions ?? []),
          ];

          // Upload files based on fileOptions
          const filesProcessed: string[] = [];
          for (const fileOption of fileOptions.reverse()) {
            const files = globSync(fileOption.files, {
              cwd: path.resolve(outputPath, copy.from),
              nodir: true,
              dot: true,
              ignore: fileOption.ignore,
            }).filter((file) => !filesProcessed.includes(file));
            filesProcessed.push(...files);

            manifest.push(
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
          }
        }
        return manifest;
      });
    }

    function uploadAssets() {
      return new KvData(
        `${name}AssetFiles`,
        {
          accountId: DEFAULT_ACCOUNT_ID,
          namespaceId: storage.id,
          entries: assetManifest.apply((manifest) =>
            manifest.map((m) => ({
              source: m.source,
              key: m.key,
              hash: m.hash,
              cacheControl: m.cacheControl,
              contentType: m.contentType,
            })),
          ),
        },
        { parent },
      );
    }

    function getContentType(filename: string, textEncoding: string) {
      const ext = filename.endsWith(".well-known/site-association-json")
        ? ".json"
        : path.extname(filename);
      const extensions = {
        [".txt"]: { mime: "text/plain", isText: true },
        [".htm"]: { mime: "text/html", isText: true },
        [".html"]: { mime: "text/html", isText: true },
        [".xhtml"]: { mime: "application/xhtml+xml", isText: true },
        [".css"]: { mime: "text/css", isText: true },
        [".js"]: { mime: "text/javascript", isText: true },
        [".mjs"]: { mime: "text/javascript", isText: true },
        [".apng"]: { mime: "image/apng", isText: false },
        [".avif"]: { mime: "image/avif", isText: false },
        [".gif"]: { mime: "image/gif", isText: false },
        [".jpeg"]: { mime: "image/jpeg", isText: false },
        [".jpg"]: { mime: "image/jpeg", isText: false },
        [".png"]: { mime: "image/png", isText: false },
        [".svg"]: { mime: "image/svg+xml", isText: true },
        [".bmp"]: { mime: "image/bmp", isText: false },
        [".tiff"]: { mime: "image/tiff", isText: false },
        [".webp"]: { mime: "image/webp", isText: false },
        [".ico"]: { mime: "image/vnd.microsoft.icon", isText: false },
        [".eot"]: { mime: "application/vnd.ms-fontobject", isText: false },
        [".ttf"]: { mime: "font/ttf", isText: false },
        [".otf"]: { mime: "font/otf", isText: false },
        [".woff"]: { mime: "font/woff", isText: false },
        [".woff2"]: { mime: "font/woff2", isText: false },
        [".json"]: { mime: "application/json", isText: true },
        [".jsonld"]: { mime: "application/ld+json", isText: true },
        [".xml"]: { mime: "application/xml", isText: true },
        [".pdf"]: { mime: "application/pdf", isText: false },
        [".zip"]: { mime: "application/zip", isText: false },
        [".wasm"]: { mime: "application/wasm", isText: false },
      };
      const extensionData = extensions[ext as keyof typeof extensions];
      const mime = extensionData?.mime ?? "application/octet-stream";
      const charset =
        extensionData?.isText && textEncoding !== "none"
          ? `;charset=${textEncoding}`
          : "";
      return `${mime}${charset}`;
    }

    function createServerWorker() {
      return new Worker(
        `${name}Server`,
        {
          ...plan.server,
          environment: output(args.environment).apply((environment) => ({
            ...environment,
            ...plan.server.environment,
          })),
          link: output(args.link).apply((link) => [
            ...(plan.server.link ?? []),
            ...(link ?? []),
          ]),
          live: false,
        },
        { parent },
      );
    }

    function createRouterWorker() {
      return new Worker(
        `${name}Router`,
        {
          handler: path.join(
            $cli.paths.platform,
            "functions",
            "cf-ssr-site-router-worker",
          ),
          url: true,
          live: false,
          domain: args.domain,
          build: {
            esbuild: assetManifest.apply((assetManifest) => ({
              define: {
                SST_ASSET_MANIFEST: JSON.stringify(
                  Object.fromEntries(assetManifest.map((e) => [e.key, e.hash])),
                ),
                SST_ROUTES: JSON.stringify(plan.routes),
              },
            })),
          },
          transform: {
            worker: (workerArgs) => {
              workerArgs.kvNamespaceBindings = [
                {
                  name: "ASSETS",
                  namespaceId: storage.id,
                },
              ];
              workerArgs.serviceBindings = [
                {
                  name: "SERVER",
                  service: server.nodes.worker.name,
                },
              ];
            },
          },
        },
        // create distribution after assets are uploaded
        { dependsOn: kvData, parent },
      );
    }
  });
}

export function validatePlan(input: {
  server: Unwrap<WorkerArgs>;
  assets: {
    copy: {
      from: string;
      to: string;
      cached: boolean;
      versionedSubDir?: string;
    }[];
  };
  routes: {
    regex: string;
    origin: "server" | "assets";
  }[];
}) {
  return input;
}

import { VisibleError } from "../error";
import { FunctionPermissionArgs } from "./function";

export const URL_UNAVAILABLE = "URL_UNAVAILABLE_IN_DEV_MODE";

/** @deprecated
 * instead try
 * ```
 * sst.linkable(MyResource, (resource) => ({
 *   properties: { ... },
 *   with: [
 *     sst.aws.permission({ actions: ["foo:*"], resources: [resource.arn] })
 *   ]
 * }))
 * ```
 */
export function linkable<T>(
  obj: { new (...args: any[]): T },
  cb: (resource: T) => FunctionPermissionArgs[],
) {
  throw new VisibleError(
    [
      "sst.aws.linkable is deprecated. Use sst.linkable instead.",
      "sst.linkable(MyResource, (resource) => ({",
      "  properties: { ... },",
      "  with: [",
      '    sst.aws.permission({ actions: ["foo:*"], resources: [resource.arn] })',
      "  ]",
      "}))",
    ].join("\n"),
  );
}

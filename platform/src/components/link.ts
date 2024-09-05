import {
  Input,
  Output,
  runtime,
  output,
  all,
  ComponentResource,
} from "@pulumi/pulumi";
import { VisibleError } from "./error.js";
import { Linkable } from "./linkable.js";

export module Link {
  export interface Definition<
    Properties extends Record<string, any> = Record<string, any>,
  > {
    properties: Properties;
    include?: {
      type: string;
      [key: string]: any;
    }[];
  }

  export class Ref extends ComponentResource {
    constructor(target: string, type: string, properties: any) {
      super(
        "sst:sst:LinkRef",
        target + "LinkRef",
        {
          properties,
        },
        {},
      );
      this.registerOutputs({
        target: target,
        properties: {
          type: type.replaceAll(":", "."),
          ...properties,
        },
      });
    }
  }

  export function reset() {
    const links = new Set<string>();
    // Ensure component names are unique
    runtime.registerStackTransformation((args) => {
      const isLinkable =
        args.type.startsWith("sst:") ||
        Linkable.wrappedResources.has(args.type);
      if (isLinkable && !args.opts.parent) {
        const lcname = args.name.toLowerCase();

        // "App" is reserved and cannot be used as a component name.
        if (lcname === "app") {
          throw new VisibleError(
            `Component name "${args.name}" is reserved. Please choose a different name for your "${args.type}" component.`,
          );
        }

        // Ensure linkable resources have unique names. This includes all SST components
        // and non-SST components that are linkable.
        if (links.has(lcname)) {
          throw new VisibleError(`Component name ${args.name} is not unique.`);
        }
        links.add(lcname);
      }
      return {
        opts: args.opts,
        props: args.props,
      };
    });

    // Create link refs
    runtime.registerStackTransformation((args) => {
      const resource = args.resource;
      process.nextTick(() => {
        if (Link.isLinkable(resource) && !args.opts.parent) {
          try {
            const link = resource.getSSTLink();
            new Ref(args.name, args.type, link.properties);
          } catch (e) {}
        }
      });
      return {
        opts: args.opts,
        props: args.props,
      };
    });
  }

  export interface Linkable {
    urn: Output<string>;
    getSSTLink(): Definition;
  }

  export function isLinkable(obj: any): obj is Linkable {
    return "getSSTLink" in obj;
  }

  export function build(links: any[]) {
    return links
      .map((link) => {
        if (!link)
          throw new VisibleError(
            "An undefined link was passed into a `link` array.",
          );
        return link;
      })
      .filter((l) => isLinkable(l))
      .map((l: Linkable) => {
        const link = l.getSSTLink();
        return all([l.urn, link]).apply(([urn, link]) => ({
          name: urn.split("::").at(-1)!,
          properties: {
            ...link.properties,
            type: urn.split("::").at(-2),
          },
        }));
      });
  }

  export function getInclude<T>(
    type: string,
    input?: Input<any[]>,
  ): Output<T[]> {
    if (!input) return output([]);
    return output(input).apply((links) => {
      return links.filter(isLinkable).flatMap((l: Linkable) => {
        const link = l.getSSTLink();
        return (link.include || []).filter((i) => i.type === type) as T[];
      });
    });
  }

  /** @deprecated
   * Use sst.Linkable.wrap instead.
   */
  export function linkable<T>(
    obj: { new (...args: any[]): T },
    cb: (resource: T) => Definition,
  ) {
    console.warn("sst.linkable is deprecated. Use sst.Linkable.wrap instead.");
    obj.prototype.getSSTLink = function () {
      return cb(this);
    };
  }
}

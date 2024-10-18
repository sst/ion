import { all, ComponentResourceOptions, Output, output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component.js";
import { Input } from "../input.js";
import { efs } from "@pulumi/aws";
import { Vpc } from "./vpc.js";

export interface EfsArgs {
  /**
   * The throughput mode for the EFS file system.
   * @default `"elastic"`
   * @example
   * ```ts
   * {
   *   throughput: "bursting",
   * }
   * ```
   */
  throughput?: Input<"provisioned" | "bursting" | "elastic">;
  /**
   * The performance mode for the EFS file system.
   * @default `"general-purpose"`
   * @example
   * ```ts
   * {
   *   performance: "max-io,
   * }
   * ```
   */
  performance?: Input<"general-purpose" | "max-io">;
  /**
   * The VPC to use for the EFS file system.
   *
   * @example
   * Create a VPC component.
   *
   * ```js
   * const myVpc = new sst.aws.Vpc("MyVpc");
   * ```
   *
   * And pass it in.
   *
   * ```js
   * {
   *   vpc: myVpc
   * }
   * ```
   *
   * Or pass in a custom VPC configuration.
   *
   * ```js
   * {
   *   vpc: {
   *     subnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"]
   *   }
   * }
   * ```
   */
  vpc:
    | Vpc
    | Input<{
        /**
         * A list of subnet IDs in the VPC to create the EFS mount targets in.
         */
        subnets: Input<Input<string>[]>;
      }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the EFS file system.
     */
    fileSystem?: Transform<efs.FileSystemArgs>;
    /**
     * Transform the EFS access point.
     */
    accessPoint?: Transform<efs.AccessPointArgs>;
  };
}

interface EfsRef {
  ref: boolean;
  fileSystem: efs.FileSystem;
  accessPoint: efs.AccessPoint;
}

/**
 * The `Efs` component lets you add an [Amazon Elastic File System (EFS)](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html) to your app.
 *
 * @example
 *
 * #### Create the file system
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const efs = new sst.aws.Efs("MyEfs", { vpc });
 * ```
 */
export class Efs extends Component {
  private _fileSystem: Output<efs.FileSystem>;
  private _accessPoint: Output<efs.AccessPoint>;

  constructor(name: string, args: EfsArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    if (args && "ref" in args) {
      const ref = args as unknown as EfsRef;
      this._fileSystem = output(ref.fileSystem);
      this._accessPoint = output(ref.accessPoint);
      return;
    }

    const parent = this;
    const vpc = normalizeVpc();
    const throughput = output(args.throughput ?? "elastic");
    const performance = output(args.performance ?? "general-purpose");

    const fileSystem = createFileSystem();
    const mountTargets = createMountTargets();
    const accessPoint = createAccessPoint();

    const waited = mountTargets.apply((targets) =>
      all(targets.map((target) => target.urn)).apply(() => ({
        fileSystem,
        accessPoint,
      })),
    );
    this._fileSystem = waited.fileSystem;
    this._accessPoint = waited.accessPoint;

    function normalizeVpc() {
      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return output({
          subnets: args.vpc.privateSubnets,
        });
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function createFileSystem() {
      return new efs.FileSystem(
        ...transform(
          args.transform?.fileSystem,
          `${name}FileSystem`,
          {
            performanceMode: performance.apply((v) =>
              v === "general-purpose" ? "generalPurpose" : "maxIO",
            ),
            throughputMode: throughput,
            encrypted: true,
          },
          { parent },
        ),
      );
    }

    function createMountTargets() {
      return vpc.subnets.apply((subnets) =>
        subnets.map(
          (subnet) =>
            new efs.MountTarget(
              `${name}MountTarget${subnet}`,
              {
                fileSystemId: fileSystem.id,
                subnetId: subnet,
              },
              { parent },
            ),
        ),
      );
    }

    function createAccessPoint() {
      return new efs.AccessPoint(
        ...transform(
          args.transform?.accessPoint,
          `${name}AccessPoint`,
          {
            fileSystemId: fileSystem.id,
            posixUser: {
              uid: 0,
              gid: 0,
            },
            rootDirectory: {
              path: "/",
            },
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The ID of the EFS file system.
   */
  public get id() {
    return this._fileSystem.id;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon EFS file system.
       */
      fileSystem: this._fileSystem,
      /**
       * The Amazon EFS access point.
       */
      accessPoint: this._accessPoint,
    };
  }

  /**
   * Reference an existing EFS file system with the given file system ID. This is useful when
   * you create a EFS file system in one stage and want to share it in another. It avoids
   * having to create a new EFS file system in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share EFS file systems across stages.
   * :::
   *
   * @param name The name of the component.
   * @param fileSystemID The id of the existing EFS file system.
   *
   * @example
   * Imagine you create a EFS file system in the `dev` stage. And in your personal stage
   * `frank`, instead of creating a new file system, you want to share the same file system
   * from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const efs = $app.stage === "frank"
   *   ? sst.aws.Efs.get("MyEfs", "app-dev-myefs")
   *   : new sst.aws.Efs("MyEfs");
   * ```
   *
   * Here `app-dev-myefs` is the ID of the file system created in the `dev` stage.
   * You can find this by outputting the file system ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   id: efs.id
   * };
   * ```
   */
  public static get(name: string, fileSystemID: Input<string>) {
    const fileSystem = efs.FileSystem.get(`${name}FileSystem`, fileSystemID);
    const accessPointId = efs
      .getAccessPointsOutput({ fileSystemId: fileSystem.id })
      .apply((accessPoints) => accessPoints.ids[0]);
    const accessPoint = efs.AccessPoint.get(
      `${name}AccessPoint`,
      accessPointId,
    );
    return new Efs(name, {
      ref: true,
      fileSystem,
      accessPoint,
    } satisfies EfsRef as unknown as EfsArgs);
  }
}

const __pulumiType = "sst:aws:Efs";
// @ts-expect-error
Efs.__pulumiType = __pulumiType;

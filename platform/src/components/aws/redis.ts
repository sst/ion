import { ComponentResourceOptions, interpolate, output } from "@pulumi/pulumi";
import { RandomPassword } from "@pulumi/random";
import { Component, Transform, transform } from "../component.js";
import { Link } from "../link.js";
import { Input } from "../input.js";
import { elasticache } from "@pulumi/aws";
import { Vpc } from "./vpc.js";
import { physicalName } from "../naming.js";

export interface RedisArgs {
  /**
   * The Redis engine version. Check out the [supported versions](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/supported-engine-versions.html).
   * @default `"7.1"`
   * @example
   * ```js
   * {
   *   version: "6.2"
   * }
   * ```
   */
  version?: Input<string>;
  /**
   * The node type to use for the Redis cluster.  Check out the [supported node types](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/CacheNodes.SupportedTypes.html).
   *
   * @default `"t4g.micro"`
   * @example
   * ```js
   * {
   *   node: "m7g.xlarge"
   * }
   * ```
   */
  node?: Input<string>;
  /**
   * The VPC to use for the Redis cluster.
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
   *     subnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"],
   *     securityGroups: ["sg-0399348378a4c256c"],
   *   }
   * }
   * ```
   */
  vpc:
    | Vpc
    | Input<{
        /**
         * A list of subnet IDs in the VPC to deploy the Redis cluster in.
         */
        subnets: Input<Input<string>[]>;
        /**
         * A list of VPC security group IDs.
         */
        securityGroups: Input<Input<string>[]>;
      }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the RDS subnet group.
     */
    subnetGroup?: Transform<elasticache.SubnetGroupArgs>;
    /**
     * Transform the Redis cluster.
     */
    cluster?: Transform<elasticache.ReplicationGroupArgs>;
  };
}

interface RedisRef {
  ref: boolean;
  cluster: elasticache.ReplicationGroup;
}

/**
 * The `Redis` component lets you add a Redis cache to your app using
 * [Amazon ElastiCache](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html).
 *
 * @example
 *
 * #### Create the cache
 *
 * ```js title="sst.config.ts"
 * const vpc = new sst.aws.Vpc("MyVpc");
 * const cache = new sst.aws.Redis("MyCache", { vpc });
 * ```
 *
 * #### Link to a resource
 *
 * You can link your cache to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [cache],
 *   vpc
 * });
 * ```
 *
 * Once linked, you can connect to it from your function code.
 *
 * ```ts title="app/page.tsx" {1,6,7,8}
 * import { Resource } from "sst";
 * import { drizzle } from "drizzle-orm/aws-data-api/pg";
 * import { RDSDataClient } from "@aws-sdk/client-rds-data";
 *
 * drizzle(new RDSDataClient({}), {
 *   database: Resource.MyDatabase.database,
 *   secretArn: Resource.MyDatabase.secretArn,
 *   resourceArn: Resource.MyDatabase.clusterArn
 * });
 * ```
 */
export class Redis extends Component implements Link.Linkable {
  private cluster: elasticache.ReplicationGroup;

  constructor(name: string, args: RedisArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    if (args && "ref" in args) {
      const ref = args as unknown as RedisRef;
      this.cluster = ref.cluster;
      return;
    }

    const parent = this;
    const version = normalizeVersion();
    const nodeType = normalizeNodeType();
    const vpc = normalizeVpc();

    const authToken = createAuthToken();
    const subnetGroup = createSubnetGroup();
    const cluster = createCluster();

    this.cluster = cluster;

    function normalizeVersion() {
      return output(args.version).apply((v) => v ?? "7.1");
    }

    function normalizeNodeType() {
      return output(args.node).apply((v) => v ?? "t4g.micro");
    }

    function normalizeVpc() {
      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return {
          subnets: args.vpc.privateSubnets,
          securityGroups: args.vpc.securityGroups,
        };
      }

      // "vpc" is object
      return output(args.vpc);
    }

    function createAuthToken() {
      return new RandomPassword(
        `${name}AuthToken`,
        {
          length: 32,
          special: true,
          overrideSpecial: "!&#$^<>-",
        },
        { parent },
      );
    }

    function createSubnetGroup() {
      return new elasticache.SubnetGroup(
        ...transform(
          args.transform?.subnetGroup,
          `${name}SubnetGroup`,
          {
            description: "Managed by SST",
            subnetIds: vpc.subnets,
          },
          { parent },
        ),
      );
    }

    function createCluster() {
      return new elasticache.ReplicationGroup(
        ...transform(
          args.transform?.cluster,
          `${name}Cluster`,
          {
            replicationGroupId: physicalName(40, name),
            description: "Managed by SST",
            engine: "redis",
            engineVersion: version,
            nodeType: interpolate`cache.${nodeType}`,
            dataTieringEnabled: nodeType.apply((v) => v.startsWith("r6gd.")),
            port: 6379,
            automaticFailoverEnabled: true,
            clusterMode: "enabled",
            numNodeGroups: 1,
            replicasPerNodeGroup: 0,
            multiAzEnabled: false,
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: true,
            transitEncryptionMode: "required",
            authToken: authToken.result,
            subnetGroupName: subnetGroup.name,
            securityGroupIds: vpc.securityGroups,
          },
          { parent },
        ),
      );
    }
  }

  /**
   * The ID of the RDS Cluster.
   */
  public get clusterID() {
    return this.cluster.id;
  }

  /**
   * The ARN of the RDS Cluster.
   */
  public get clusterArn() {
    return this.cluster.arn;
  }

  /** The username used to authenticate to the cache. */
  public get username() {
    return "default";
  }

  /** The password used to authenticate to the cache. */
  public get password() {
    return this.cluster.authToken;
  }

  /**
   * The port of the cache cluster.
   */
  public get port() {
    return this.cluster.port;
  }

  /**
   * The host of the cache cluster.
   */
  public get host() {
    return this.cluster.configurationEndpointAddress;
  }

  public get nodes() {
    return {
      cluster: this.cluster,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        clusterArn: this.clusterArn,
        username: this.username,
        password: this.password,
        port: this.port,
        host: this.host,
      },
    };
  }

  /**
   * Reference an existing Redis cluster with the given cluster name. This is useful when you
   * create a Redis cluster in one stage and want to share it in another. It avoids having to
   * create a new Redis cluster in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share Redis clusters across stages.
   * :::
   *
   * @param name The name of the component.
   * @param clusterID The id of the existing Redis cluster.
   *
   * @example
   * Imagine you create a cluster in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new cluster, you want to share the same cluster from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const cache = $app.stage === "frank"
   *   ? sst.aws.Redis.get("MyCache", "app-dev-mycache")
   *   : new sst.aws.Redis("MyCache");
   * ```
   *
   * Here `app-dev-mycache` is the ID of the cluster created in the `dev` stage.
   * You can find this by outputting the cluster ID in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   cluster: cache.clusterID
   * };
   * ```
   */
  public static get(name: string, clusterID: Input<string>) {
    const cluster = elasticache.ReplicationGroup.get(
      `${name}Cluster`,
      clusterID,
    );
    return new Redis(name, { ref: true, cluster } as unknown as RedisArgs);
  }
}

const __pulumiType = "sst:aws:Redis";
// @ts-expect-error
Redis.__pulumiType = __pulumiType;

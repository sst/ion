import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as docker from "@pulumi/docker";
import { Component, Prettify, Transform, transform } from "../component";
import { Input } from "../input";
import { Dns } from "../dns";
import { FunctionArgs } from "./function";
import { Service } from "./service";
import { RETENTION } from "./logging.js";

export const supportedCpus = {
  "0.25 vCPU": 256,
  "0.5 vCPU": 512,
  "1 vCPU": 1024,
  "2 vCPU": 2048,
  "4 vCPU": 4096,
  "8 vCPU": 8192,
  "16 vCPU": 16384,
};

export const supportedMemories = {
  "0.25 vCPU": {
    "0.5 GB": 512,
    "1 GB": 1024,
    "2 GB": 2048,
  },
  "0.5 vCPU": {
    "1 GB": 1024,
    "2 GB": 2048,
    "3 GB": 3072,
    "4 GB": 4096,
  },
  "1 vCPU": {
    "2 GB": 2048,
    "3 GB": 3072,
    "4 GB": 4096,
    "5 GB": 5120,
    "6 GB": 6144,
    "7 GB": 7168,
    "8 GB": 8192,
  },
  "2 vCPU": {
    "4 GB": 4096,
    "5 GB": 5120,
    "6 GB": 6144,
    "7 GB": 7168,
    "8 GB": 8192,
    "9 GB": 9216,
    "10 GB": 10240,
    "11 GB": 11264,
    "12 GB": 12288,
    "13 GB": 13312,
    "14 GB": 14336,
    "15 GB": 15360,
    "16 GB": 16384,
  },
  "4 vCPU": {
    "8 GB": 8192,
    "9 GB": 9216,
    "10 GB": 10240,
    "11 GB": 11264,
    "12 GB": 12288,
    "13 GB": 13312,
    "14 GB": 14336,
    "15 GB": 15360,
    "16 GB": 16384,
    "17 GB": 17408,
    "18 GB": 18432,
    "19 GB": 19456,
    "20 GB": 20480,
    "21 GB": 21504,
    "22 GB": 22528,
    "23 GB": 23552,
    "24 GB": 24576,
    "25 GB": 25600,
    "26 GB": 26624,
    "27 GB": 27648,
    "28 GB": 28672,
    "29 GB": 29696,
    "30 GB": 30720,
  },
  "8 vCPU": {
    "16 GB": 16384,
    "20 GB": 20480,
    "24 GB": 24576,
    "28 GB": 28672,
    "32 GB": 32768,
    "36 GB": 36864,
    "40 GB": 40960,
    "44 GB": 45056,
    "48 GB": 49152,
    "52 GB": 53248,
    "56 GB": 57344,
    "60 GB": 61440,
  },
  "16 vCPU": {
    "32 GB": 32768,
    "40 GB": 40960,
    "48 GB": 49152,
    "56 GB": 57344,
    "64 GB": 65536,
    "72 GB": 73728,
    "80 GB": 81920,
    "88 GB": 90112,
    "96 GB": 98304,
    "104 GB": 106496,
    "112 GB": 114688,
    "120 GB": 122880,
  },
};

type Port = `${number}/${"http" | "https" | "tcp" | "udp" | "tcp_udp" | "tls"}`;

export interface ClusterArgs {
  /**
   * The VPC to use for the cluster.
   *
   * @example
   * ```js
   * {
   *   vpc: {
   *     id: ["vpc-0d19d2b8ca2b268a1"],
   *     publicSubnets: ["subnet-0b6a2b73896dc8c4c", "subnet-021389ebee680c2f0"],
   *     privateSubnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"],
   *     securityGroups: ["sg-0399348378a4c256c"],
   *   }
   * }
   * ```
   */
  vpc: Input<{
    /**
     * The ID of the VPC.
     */
    id: Input<string>;
    /**
     * A list of public subnet IDs in the VPC. If a service has public ports configured,
     * its load balancer will be placed in the public subnets.
     */
    publicSubnets: Input<Input<string>[]>;
    /**
     * A list of private subnet IDs in the VPC. The service will be placed in the private
     * subnets.
     */
    privateSubnets: Input<Input<string>[]>;
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
     * Transform the ECS Cluster resource.
     */
    cluster?: Transform<aws.ecs.ClusterArgs>;
  };
}

export interface ClusterServiceArgs {
  /**
   * Configure the docker build command for building the image.
   *
   * Prior to building the image, SST will automatically add the `.sst` directory
   * to the `.dockerignore` file if not already present.
   *
   * @default `&lcub;&rcub;`
   * @example
   * ```js
   * {
   *   image: {
   *     context: "./app",
   *     dockerfile: "Dockerfile",
   *     args: {
   *       MY_VAR: "value"
   *     }
   *   }
   * }
   * ```
   */
  image?: Input<{
    /**
     * The path to the [Docker build context](https://docs.docker.com/build/building/context/#local-context).
     * The path is relative to your `sst.config.ts`.
     * @default `"."`
     * @example
     *
     * Change where the docker build context is located.
     *
     * ```js
     * {
     *   context: "./app"
     * }
     * ```
     */
    context?: Input<string>;
    /**
     * The path to the [Dockerfile](https://docs.docker.com/reference/cli/docker/image/build/#file).
     * The path is relative to the build context.
     * @default `"Dockerfile"`
     * @example
     * ```js
     * {
     *   dockerfile: "Dockerfile.prod"
     * }
     * ```
     */
    dockerfile?: Input<string>;
    /**
     * [Build args](https://docs.docker.com/build/guide/build-args/) to pass to the docker build command.
     * @example
     * ```js
     * {
     *   args: {
     *     MY_VAR: "value"
     *   }
     * }
     * ```
     */
    args?: Input<Record<string, Input<string>>>;
  }>;
  /**
   * Configure a public endpoint for the service. When configured, a load balancer
   * will be created to route traffic to the containers. Your users can access the service
   * using this endpoint.
   *
   * You can also configure a custom domain for the public endpoint.
   *
   * @example
   * ```js
   * {
   *   public: {
   *     domain: "domain.com",
   *     ports: [
   *       { listen: "80/http" },
   *       { listen: "443/https", forward: "80/http" }
   *     ]
   *   }
   * }
   * ```
   */
  public?: Input<{
    /**
     * Set a custom domain for your public endpoint.
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
     */
    domain?: Input<
      | string
      | {
          /**
           * The custom domain you want to use.
           *
           * @example
           * ```js
           * {
           *   domain: {
           *     name: "example.com"
           *   }
           * }
           * ```
           *
           * Can also include subdomains based on the current stage.
           *
           * ```js
           * {
           *   domain: {
           *     name: `${$app.stage}.example.com`
           *   }
           * }
           * ```
           */
          name: Input<string>;
          /**
           * The ARN of an ACM (AWS Certificate Manager) certificate that proves ownership of the
           * domain. By default, a certificate is created and validated automatically.
           *
           * :::tip
           * You need to pass in a `cert` for domains that are not hosted on supported `dns` providers.
           * :::
           *
           * To manually set up a domain on an unsupported provider, you'll need to:
           *
           * 1. [Validate that you own the domain](https://docs.aws.amazon.com/acm/latest/userguide/domain-ownership-validation.html) by creating an ACM certificate. You can either validate it by setting a DNS record or by verifying an email sent to the domain owner.
           * 2. Once validated, set the certificate ARN as the `cert` and set `dns` to `false`.
           * 3. Add the DNS records in your provider to point to the load balancer endpoint.
           *
           * @example
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: false,
           *     cert: "arn:aws:acm:us-east-1:112233445566:certificate/3a958790-8878-4cdc-a396-06d95064cf63"
           *   }
           * }
           * ```
           */
          cert?: Input<string>;
          /**
           * The DNS provider to use for the domain. Defaults to the AWS.
           *
           * Takes an adapter that can create the DNS records on the provider. This can automate
           * validating the domain and setting up the DNS routing.
           *
           * Supports Route 53, Cloudflare, and Vercel adapters. For other providers, you'll need
           * to set `dns` to `false` and pass in a certificate validating ownership via `cert`.
           *
           * @default `sst.aws.dns`
           *
           * @example
           *
           * Specify the hosted zone ID for the Route 53 domain.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.aws.dns({
           *       zone: "Z2FDTNDATAQYW2"
           *     })
           *   }
           * }
           * ```
           *
           * Use a domain hosted on Cloudflare, needs the Cloudflare provider.
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
           * Use a domain hosted on Vercel, needs the Vercel provider.
           *
           * ```js
           * {
           *   domain: {
           *     name: "example.com",
           *     dns: sst.vercel.dns()
           *   }
           * }
           * ```
           */
          dns?: Input<false | (Dns & {})>;
        }
    >;
    /**
     * Configure the port mappings the public endpoint listens to and forwards to the service.
     *
     * Two classes of protocols are supported:
     * - Application Layer Protocols: `http` and `https`
     * - Network Layer Protocols: `tcp`, `udp`, `tcp_udp`, and `tls`
     *
     * If application layer protocols are used, an [Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html) is created.
     * And if network layer protocols are used, a [Network Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html) is created.
     *
     * :::note
     * You can not configure both application and network layer protocols in the same service.
     * :::
     *
     * :::note
     * If ports are configured to listen on `https` or `tls` protocols, a custom domain is required.
     * :::
     *
     * @example
     * ```js
     * {
     *   public: {
     *     ports: [
     *       { listen: "80/http", forward: "8080/http" }
     *     ]
     *   }
     * }
     * ```
     *
     * If the forward port and protocol are the same as those the service listens on,
     * you can omit the `forward` field.
     *
     * ```js
     * {
     *   public: {
     *     ports: [
     *       { listen: "80/http" }
     *     ]
     *   }
     * }
     * ```
     */
    ports: Input<
      {
        /**
         * The port and protocol the service listens on.
         */
        listen: Input<Port>;
        /**
         * The port and protocol of the container the service forwards the traffic to.
         * @default The same port and protocol as `listen`
         */
        forward?: Input<Port>;
      }[]
    >;
  }>;
  /**
   * The CPU architecture of the container.
   * @default "x86_64"
   * @example
   * ```js
   * {
   *   architecture: "arm64",
   * }
   * ```
   */
  architecture?: Input<"x86_64" | "arm64">;
  /**
   * The amount of CPU allocated.
   *
   * :::note
   * Only certain combinations of CPU and memory are supported. [View the valid combinations of CPU and memory](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html#fargate-tasks-size).
   * :::
   *
   * @default "0.25 vCPU"
   * @example
   * ```js
   * {
   *   cpu: "1 vCPU",
   * }
   *```
   */
  cpu?: keyof typeof supportedCpus;
  /**
   * The amount of memory allocated.
   *
   * :::note
   * Only certain combinations of CPU and memory are supported. [View the valid combinations of CPU and memory](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html#fargate-tasks-size).
   * :::
   *
   * @default "0.5 GB"
   * @example
   * ```js
   * {
   *   memory: "2 GB",
   * }
   *```
   */
  memory?: `${number} GB`;
  /**
   * The amount of ephemeral storage allocated, in GB.
   * @default "21 GB"
   * @example
   * ```js
   * {
   *   storage: "100 GB",
   * }
   * ```
   */
  storage?: `${number} GB`;
  /**
   * [Link resources](/docs/linking/) to your service. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your site using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the service.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: FunctionArgs["link"];
  /**
   * Permissions and the resources that the service needs to access. These permissions are
   * used to create the service's [task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).
   *
   * :::tip
   * If you `link` the service to a resource, the permissions to access it are
   * automatically added.
   * :::
   *
   * @example
   * Allow the service to read and write to an S3 bucket called `my-bucket`.
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
   * Allow the service to perform all actions on an S3 bucket called `my-bucket`.
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
   * Granting the service permissions to access all resources.
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
  permissions?: FunctionArgs["permissions"];
  /**
   * Key-value pairs of values that are set as [container environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html).
   * The keys need to:
   * - Start with a letter
   * - Be at least 2 characters long
   * - Contain only letters, numbers, or underscores
   *
   * @example
   *
   * ```js
   * {
   *   environment: {
   *     DEBUG: "true"
   *   }
   * }
   * ```
   */
  environment?: FunctionArgs["environment"];
  /**
   * Configure the service logs in CloudWatch.
   * @default `&lcub;retention: "forever"&rcub;`
   * @example
   * ```js
   * {
   *   logging: {
   *     retention: "1 week"
   *   }
   * }
   * ```
   */
  logging?: Input<{
    /**
     * The duration the service logs are kept in CloudWatch.
     * @default `forever`
     */
    retention?: Input<keyof typeof RETENTION>;
  }>;
  /**
   * Configure the service to automatically scale in or out based on the CPU or memory utilization.
   * By default, scaling is disabled. The service will run with a single container.
   *
   * @example
   * ```js
   * {
   *   scaling: {
   *     min: 4,
   *     max: 16,
   *     cpuUtilization: 50,
   *     memoryUtilization: 50,
   *   }
   * }
   */
  scaling?: Input<{
    /**
     * The minimum number of containers to run.
     * @default 1
     * @example
     * ```js
     * {
     *   scaling: {
     *    minContainers: 4,
     *    maxContainers: 16,
     *   },
     * }
     *```
     */
    min?: Input<number>;
    /**
     * The maximum number of containers to run.
     * @default 1
     * @example
     * ```js
     * {
     *   scaling: {
     *    minContainers: 4,
     *    maxContainers: 16,
     *   },
     * }
     *```
     */
    max?: Input<number>;
    /**
     * The target CPU utilization percentage to scale in or out. The service will scale in
     * when the CPU utilization is below the target and scale out when it is above the target.
     * @default 70
     * @example
     * ```js
     * {
     *   scaling: {
     *    cpuUtilization: 50,
     *   },
     * }
     *```
     */
    cpuUtilization?: Input<number>;
    /**
     * The target memory utilization percentage to scale in or out. The service will scale in
     * when the memory utilization is below the target and scale out when it is above the target.
     * @default 70
     * @example
     * ```js
     * {
     *   scaling: {
     *    memoryUtilization: 50,
     *   },
     * }
     *```
     */
    memoryUtilization?: Input<number>;
  }>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Docker Image resource.
     */
    image?: Transform<docker.ImageArgs>;
    /**
     * Transform the ECS Service resource.
     */
    service?: Transform<aws.ecs.ServiceArgs>;
    /**
     * Transform the ECS Task IAM Role resource.
     */
    taskRole?: Transform<aws.iam.RoleArgs>;
    /**
     * Transform the ECS Task Definition resource.
     */
    taskDefinition?: Transform<aws.ecs.TaskDefinitionArgs>;
    /**
     * Transform the AWS Load Balancer resource.
     */
    loadBalancer?: Transform<aws.lb.LoadBalancerArgs>;
    /**
     * Transform the AWS Load Balancer listener resource.
     */
    listener?: Transform<aws.lb.ListenerArgs>;
    /**
     * Transform the AWS Load Balancer target group resource.
     */
    target?: Transform<aws.lb.TargetGroupArgs>;
    /**
     * Transform the CloudWatch log group resource.
     */
    logGroup?: Transform<aws.cloudwatch.LogGroupArgs>;
  };
}

/**
 * The `Cluster` component lets you create a cluster of containers that run your app.
 * It uses [Amazon Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
 *
 * @example
 *
 * #### Create a Cluster
 *
 * ```ts
 * const cluster = new sst.aws.Cluster("MyCluster", {
 *   vpc: {
 *     id: ["vpc-0d19d2b8ca2b268a1"],
 *     publicSubnets: ["subnet-0b6a2b73896dc8c4c", "subnet-021389ebee680c2f0"],
 *     privateSubnets: ["subnet-0db7376a7ad4db5fd ", "subnet-06fc7ee8319b2c0ce"],
 *     securityGroups: ["sg-0399348378a4c256c"],
 *   }
 * });
 * ```
 *
 * #### Add a service
 *
 * ```ts
 * cluster.addService("MyService", {
 *   public: {
 *     domain: "domain.com",
 *     ports: [
 *       { listen: "80/http" },
 *       { listen: "443/https", forward: "80/http" },
 *     ]
 *   }
 * });
 * ```
 */
export class Cluster extends Component {
  private constructorName: string;
  private constructorArgs: ClusterArgs;
  private cluster: aws.ecs.Cluster;

  constructor(
    name: string,
    args: ClusterArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const cluster = createCluster();

    this.constructorName = name;
    this.constructorArgs = args;
    this.cluster = cluster;

    function createCluster() {
      return new aws.ecs.Cluster(
        `${name}Cluster`,
        transform(args.transform?.cluster, {}),
        { parent },
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon ECS Cluster.
       */
      cluster: this.cluster,
    };
  }

  /**
   * Add a service to the cluster.
   *
   * @param name Name of the service.
   * @param args Configure the service.
   *
   * @example
   *
   * ```ts
   * cluster.addService("MyService");
   * ```
   *
   * Set a custom domain for the service.
   *
   * ```js {3}
   * cluster.addService("MyService", {
   *   domain: "my-app.com"
   * });
   * ```
   *
   * [Link resources](/docs/linking/) to your service. This will grant permissions
   * to the resources and allow you to access it in your app.
   *
   * ```ts {5}
   * const bucket = new sst.aws.Bucket("MyBucket");
   *
   * cluster.addService("MyService", {
   *   link: [bucket]
   * });
   * ```
   *
   * If your service app is written in Node.js, you can use the [SDK](/docs/reference/sdk/)
   * to access the linked resources.
   *
   * ```ts title="app.ts"
   * import { Resource } from "sst";
   *
   * console.log(Resource.MyBucket.name);
   * ```
   */
  public addService(name: string, args?: ClusterServiceArgs) {
    const prefix = this.constructorName;
    return new Service(`${prefix}Service${name}`, {
      name,
      cluster: {
        name: this.cluster.name,
        arn: this.cluster.arn,
      },
      vpc: this.constructorArgs.vpc,
      ...args,
    });
  }
}

const __pulumiType = "sst:aws:Cluster";
// @ts-expect-error
Cluster.__pulumiType = __pulumiType;

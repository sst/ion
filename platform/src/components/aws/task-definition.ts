import fs from "fs";
import path from "path";
import {
  ComponentResourceOptions,
  Input,
  all,
  interpolate,
  output,
  secret,
} from "@pulumi/pulumi";
import { Image, Platform } from "@pulumi/docker-build";
import { Component, transform } from "../component.js";
import { toGBs, toMBs } from "../size.js";
import { toNumber } from "../cpu.js";
import { Link } from "../link.js";
import { bootstrap } from "./helpers/bootstrap.js";
import {
  ClusterArgs,
  ClusterTaskDefinitionArgs,
  supportedCpus,
  supportedMemories,
} from "./cluster.js";
import { RETENTION } from "./logging.js";
import {
  cloudwatch,
  ecr,
  ecs,
  getCallerIdentityOutput,
  getRegionOutput,
  iam,
} from "@pulumi/aws";
import { Permission } from "./permission.js";

export interface TaskDefinitionArgs extends ClusterTaskDefinitionArgs {
  /**
   * The cluster to use for the service.
   */
  cluster: Input<{
    /**
     * The name of the cluster.
     */
    name: Input<string>;
    /**
     * The ARN of the cluster.
     */
    arn: Input<string>;
  }>;
  /**
   * The VPC to use for the cluster.
   */
  vpc: ClusterArgs["vpc"];
}

/**
 * The `TaskDefinition` component is internally used by the `Cluster` component to deploy services to
 * [Amazon ECS](https://aws.amazon.com/ecs/). It uses [AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
 *
 * :::note
 * This component is not meant to be created directly.
 * :::
 *
 * This component is returned by the `addTaskDefinition` method of the `Cluster` component.
 */
export class TaskDefinition extends Component implements Link.Linkable {
  private readonly taskRole: iam.Role;
  private readonly taskDefinition?: ecs.TaskDefinition;

  constructor(
    name: string,
    args: TaskDefinitionArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const cluster = output(args.cluster);
    const region = normalizeRegion();
    const architecture = normalizeArchitecture();
    const imageArgs = normalizeImage();
    const cpu = normalizeCpu();
    const memory = normalizeMemory();
    const storage = normalizeStorage();
    const logging = normalizeLogging();

    const linkData = buildLinkData();
    const linkPermissions = buildLinkPermissions();

    const taskRole = createTaskRole();

    this.taskRole = taskRole;

    const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
    const executionRole = createExecutionRole();
    const image = createImage();
    const logGroup = createLogGroup();
    const taskDefinition = createTaskDefinition();
    this.taskDefinition = taskDefinition;

    function normalizeRegion() {
      return getRegionOutput(undefined, { parent: self }).name;
    }

    function normalizeArchitecture() {
      return output(args.architecture ?? "x86_64").apply((v) => v);
    }

    function normalizeImage() {
      return all([args.image, architecture]).apply(([image, architecture]) => {
        if (typeof image === "string") return image;

        return {
          ...image,
          context: image?.context ?? ".",
          platform:
            architecture === "arm64"
              ? Platform.Linux_arm64
              : Platform.Linux_amd64,
        };
      });
    }

    function normalizeCpu() {
      return output(args.cpu ?? "0.25 vCPU").apply((v) => {
        if (!supportedCpus[v]) {
          throw new Error(
            `Unsupported CPU: ${v}. The supported values for CPU are ${Object.keys(
              supportedCpus,
            ).join(", ")}`,
          );
        }
        return v;
      });
    }

    function normalizeMemory() {
      return all([cpu, args.memory ?? "0.5 GB"]).apply(([cpu, v]) => {
        if (!(v in supportedMemories[cpu])) {
          throw new Error(
            `Unsupported memory: ${v}. The supported values for memory for a ${cpu} CPU are ${Object.keys(
              supportedMemories[cpu],
            ).join(", ")}`,
          );
        }
        return v;
      });
    }

    function normalizeStorage() {
      return output(args.storage ?? "21 GB").apply((v) => {
        const storage = toGBs(v);
        if (storage < 21 || storage > 200)
          throw new Error(
            `Unsupported storage: ${v}. The supported value for storage is between "21 GB" and "200 GB"`,
          );
        return v;
      });
    }

    function normalizeLogging() {
      return output(args.logging).apply((logging) => ({
        ...logging,
        retention: logging?.retention ?? "forever",
      }));
    }

    function buildLinkData() {
      return output(args.link || []).apply((links) => Link.build(links));
    }

    function buildLinkPermissions() {
      return Link.getInclude<Permission>("aws.permission", args.link);
    }

    function createImage() {
      return imageArgs.apply((imageArgs) => {
        if (typeof imageArgs === "string") return output(imageArgs);

        const contextPath = path.join($cli.paths.root, imageArgs.context);
        const dockerfile = imageArgs.dockerfile ?? "Dockerfile";
        const dockerfilePath = imageArgs.dockerfile
          ? path.join(contextPath, imageArgs.dockerfile)
          : path.join(contextPath, imageArgs.context, "Dockerfile");
        const dockerIgnorePath = fs.existsSync(
          path.join(contextPath, `${dockerfile}.dockerignore`),
        )
          ? path.join(contextPath, `${dockerfile}.dockerignore`)
          : path.join(contextPath, ".dockerignore");

        // add .sst to .dockerignore if not exist
        const lines = fs.existsSync(dockerIgnorePath)
          ? fs.readFileSync(dockerIgnorePath).toString().split("\n")
          : [];
        if (!lines.find((line) => line === ".sst")) {
          fs.writeFileSync(
            dockerIgnorePath,
            [...lines, "", "# sst", ".sst"].join("\n"),
          );
        }

        // Build image
        const image = new Image(
          ...transform(
            args.transform?.image,
            `${name}Image`,
            {
              context: { location: contextPath },
              dockerfile: { location: dockerfilePath },
              buildArgs: imageArgs.args ?? {},
              platforms: [imageArgs.platform],
              tags: [interpolate`${bootstrapData.assetEcrUrl}:${name}`],
              registries: [
                ecr
                  .getAuthorizationTokenOutput({
                    registryId: bootstrapData.assetEcrRegistryId,
                  })
                  .apply((authToken) => ({
                    address: authToken.proxyEndpoint,
                    password: secret(authToken.password),
                    username: authToken.userName,
                  })),
              ],
              push: true,
            },
            { parent: self },
          ),
        );

        return interpolate`${bootstrapData.assetEcrUrl}@${image.digest}`;
      });
    }

    function createLogGroup() {
      return new cloudwatch.LogGroup(
        ...transform(
          args.transform?.logGroup,
          `${name}LogGroup`,
          {
            name: interpolate`/sst/cluster/${cluster.name}/${name}`,
            retentionInDays: logging.apply(
              (logging) => RETENTION[logging.retention],
            ),
          },
          { parent: self },
        ),
      );
    }

    function createTaskRole() {
      const policy = all([args.permissions || [], linkPermissions]).apply(
        ([argsPermissions, linkPermissions]) =>
          iam.getPolicyDocumentOutput({
            statements: [
              ...argsPermissions,
              ...linkPermissions.map((item) => ({
                actions: item.actions,
                resources: item.resources,
              })),
              {
                actions: [
                  "ssmmessages:CreateControlChannel",
                  "ssmmessages:CreateDataChannel",
                  "ssmmessages:OpenControlChannel",
                  "ssmmessages:OpenDataChannel",
                ],
                resources: ["*"],
              },
            ],
          }),
      );

      return new iam.Role(
        ...transform(
          args.transform?.taskRole,
          `${name}TaskRole`,
          {
            assumeRolePolicy: !$dev
              ? iam.assumeRolePolicyForPrincipal({
                  Service: "ecs-tasks.amazonaws.com",
                })
              : iam.assumeRolePolicyForPrincipal({
                  AWS: interpolate`arn:aws:iam::${
                    getCallerIdentityOutput().accountId
                  }:root`,
                }),
            inlinePolicies: policy.apply(({ statements }) =>
              statements ? [{ name: "inline", policy: policy.json }] : [],
            ),
          },
          { parent: self },
        ),
      );
    }

    function createExecutionRole() {
      return new iam.Role(
        `${name}ExecutionRole`,
        {
          assumeRolePolicy: iam.assumeRolePolicyForPrincipal({
            Service: "ecs-tasks.amazonaws.com",
          }),
          managedPolicyArns: [
            "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
          ],
        },
        { parent: self },
      );
    }

    function createTaskDefinition() {
      return new ecs.TaskDefinition(
        ...transform(
          args.transform?.taskDefinition,
          `${name}Task`,
          {
            family: interpolate`${cluster.name}-${name}`,
            trackLatest: true,
            cpu: cpu.apply((v) => toNumber(v).toString()),
            memory: memory.apply((v) => toMBs(v).toString()),
            networkMode: "awsvpc",
            ephemeralStorage: {
              sizeInGib: storage.apply((v) => toGBs(v)),
            },
            requiresCompatibilities: ["FARGATE"],
            runtimePlatform: {
              cpuArchitecture: architecture.apply((v) => v.toUpperCase()),
              operatingSystemFamily: "LINUX",
            },
            executionRoleArn: executionRole.arn,
            taskRoleArn: taskRole.arn,
            containerDefinitions: $jsonStringify([
              {
                name,
                image,
                pseudoTerminal: true,
                portMappings: [{ containerPortRange: "1-65535" }],
                logConfiguration: {
                  logDriver: "awslogs",
                  options: {
                    "awslogs-group": logGroup.name,
                    "awslogs-region": region,
                    "awslogs-stream-prefix": "/service",
                  },
                },
                environment: all([args.environment ?? [], linkData]).apply(
                  ([env, linkData]) => [
                    ...Object.entries(env).map(([name, value]) => ({
                      name,
                      value,
                    })),
                    ...linkData.map((d) => ({
                      name: `SST_RESOURCE_${d.name}`,
                      value: JSON.stringify(d.properties),
                    })),
                    {
                      name: "SST_RESOURCE_App",
                      value: JSON.stringify({
                        name: $app.name,
                        stage: $app.stage,
                      }),
                    },
                  ],
                ),
                linuxParameters: {
                  initProcessEnabled: true,
                },
              },
            ]),
          },
          { parent: self },
        ),
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon ECS Task Role.
       */
      get taskRole() {
        return self.taskRole;
      },
      /**
       * The Amazon ECS Task Definition.
       */
      get taskDefinition() {
        return self.taskDefinition!;
      },
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        definition: this.taskDefinition,
      },
    };
  }
}

const __pulumiType = "sst:aws:TaskDefinition";
// @ts-expect-error
TaskDefinition.__pulumiType = __pulumiType;

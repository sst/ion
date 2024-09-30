import fs from "fs";
import path from "path";
import {
  ComponentResourceOptions,
  Input,
  Output,
  all,
  interpolate,
  output,
  secret,
} from "@pulumi/pulumi";
import { Image, Platform } from "@pulumi/docker-build";
import { $print, Component, transform } from "../component.js";
import { toGBs, toMBs } from "../size.js";
import { toNumber } from "../cpu.js";
import { dns as awsDns } from "./dns.js";
import { VisibleError } from "../error.js";
import { DnsValidatedCertificate } from "./dns-validated-certificate.js";
import { Link } from "../link.js";
import { bootstrap } from "./helpers/bootstrap.js";
import {
  ClusterArgs,
  ClusterServiceArgs,
  supportedCpus,
  supportedMemories,
} from "./cluster.js";
import { RETENTION } from "./logging.js";
import { URL_UNAVAILABLE } from "./linkable.js";
import {
  appautoscaling,
  cloudwatch,
  ec2,
  ecr,
  ecs,
  getCallerIdentityOutput,
  getRegionOutput,
  iam,
  lb,
  servicediscovery,
} from "@pulumi/aws";
import { Permission } from "./permission.js";
import { Vpc } from "./vpc.js";
import { Vpc as VpcV1 } from "./vpc-v1";
import { DevCommand } from "../experimental/dev-command.js";

export interface ServiceArgs extends ClusterServiceArgs {
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
 * The `Service` component is internally used by the `Cluster` component to deploy services to
 * [Amazon ECS](https://aws.amazon.com/ecs/). It uses [AWS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).
 *
 * :::note
 * This component is not meant to be created directly.
 * :::
 *
 * This component is returned by the `addService` method of the `Cluster` component.
 */
export class Service extends Component implements Link.Linkable {
  private readonly _service?: ecs.Service;
  private readonly cloudmapNamespace?: Output<string>;
  private readonly cloudmapService?: servicediscovery.Service;
  private readonly taskRole: iam.Role;
  private readonly taskDefinition?: ecs.TaskDefinition;
  private readonly loadBalancer?: lb.LoadBalancer;
  private readonly domain?: Output<string | undefined>;
  private readonly _url?: Output<string>;
  private readonly devUrl?: Output<string>;

  constructor(
    name: string,
    args: ServiceArgs,
    opts?: ComponentResourceOptions,
  ) {
    super(__pulumiType, name, args, opts);

    const self = this;

    const cluster = output(args.cluster);
    const { isSstVpc, vpc } = normalizeVpc();
    const region = normalizeRegion();
    const architecture = normalizeArchitecture();
    const cpu = normalizeCpu();
    const memory = normalizeMemory();
    const storage = normalizeStorage();
    const scaling = normalizeScaling();
    const containers = normalizeContainers();
    const pub = normalizePublic();

    const linkData = buildLinkData();
    const linkPermissions = buildLinkPermissions();

    const taskRole = createTaskRole();

    this.cloudmapNamespace = vpc.cloudmapNamespaceName;
    this.taskRole = taskRole;

    if ($dev) {
      this.devUrl = !pub ? undefined : output(args.dev?.url ?? URL_UNAVAILABLE);
      registerReceiver();
      return;
    }

    const bootstrapData = region.apply((region) => bootstrap.forRegion(region));
    const executionRole = createExecutionRole();
    const taskDefinition = createTaskDefinition();
    const certificateArn = createSsl();
    const { loadBalancer, targets } = createLoadBalancer();
    const cloudmapService = createCloudmapService();
    const service = createService();
    createAutoScaling();
    createDnsRecords();

    this._service = service;
    this.cloudmapService = cloudmapService;
    this.taskDefinition = taskDefinition;
    this.loadBalancer = loadBalancer;
    this.domain = pub?.domain
      ? pub.domain.apply((domain) => domain?.name)
      : output(undefined);
    this._url = !self.loadBalancer
      ? undefined
      : all([self.domain, self.loadBalancer?.dnsName]).apply(
          ([domain, loadBalancer]) =>
            domain ? `https://${domain}/` : `http://${loadBalancer}`,
        );

    registerHint();
    registerReceiver();

    function normalizeVpc() {
      // "vpc" is a Vpc.v1 component
      if (args.vpc instanceof VpcV1) {
        throw new VisibleError(
          `You are using the "Vpc.v1" component. Please migrate to the latest "Vpc" component.`,
        );
      }

      // "vpc" is a Vpc component
      if (args.vpc instanceof Vpc) {
        return {
          isSstVpc: true,
          vpc: {
            id: args.vpc.id,
            loadBalancerSubnets: args.vpc.publicSubnets,
            serviceSubnets: args.vpc.publicSubnets,
            securityGroups: args.vpc.securityGroups,
            cloudmapNamespaceId: args.vpc.nodes.cloudmapNamespace.id,
            cloudmapNamespaceName: args.vpc.nodes.cloudmapNamespace.name,
          },
        };
      }

      // "vpc" is object
      return { vpc: output(args.vpc) };
    }

    function normalizeRegion() {
      return getRegionOutput(undefined, { parent: self }).name;
    }

    function normalizeArchitecture() {
      return output(args.architecture ?? "x86_64").apply((v) => v);
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

    function normalizeScaling() {
      return output(args.scaling).apply((v) => ({
        min: v?.min ?? 1,
        max: v?.max ?? 1,
        cpuUtilization: v?.cpuUtilization ?? 70,
        memoryUtilization: v?.memoryUtilization ?? 70,
      }));
    }

    function normalizeContainers() {
      if (args.containers && (args.image || args.logging || args.environment)) {
        throw new VisibleError(
          `You cannot provide both "containers" and "image", "logging", or "environment".`,
        );
      }

      // Standardize containers
      const containers = args.containers ?? [
        {
          name: name,
          image: args.image,
          logging: args.logging,
          environment: args.environment,
          command: args.command,
          entrypoint: args.entrypoint,
          dev: args.dev,
        },
      ];

      // Normalize container props
      return output(containers).apply((containers) =>
        containers.map((v) => {
          return {
            ...v,
            image: normalizeImage(),
            logging: normalizeLogging(),
          };

          function normalizeImage() {
            return all([v.image, architecture]).apply(
              ([image, architecture]) => {
                if (typeof image === "string") return image;

                return {
                  ...image,
                  context: image?.context ?? ".",
                  platform:
                    architecture === "arm64"
                      ? Platform.Linux_arm64
                      : Platform.Linux_amd64,
                };
              },
            );
          }

          function normalizeLogging() {
            return output(v.logging).apply((logging) => ({
              ...logging,
              retention: logging?.retention ?? "forever",
            }));
          }
        }),
      );
    }

    function normalizePublic() {
      if (!args.public) return;

      const ports = all([args.public, containers]).apply(
        ([pub, containers]) => {
          // validate ports
          if (!pub.ports || pub.ports.length === 0)
            throw new VisibleError(
              `You must provide the ports to expose via "public.ports".`,
            );

          // validate container defined when multiple containers exists
          if (containers.length > 1) {
            pub.ports.forEach((v) => {
              if (!v.container)
                throw new VisibleError(
                  `You must provide a container name in "public.ports" when there is more than one container.`,
                );
            });
          }

          // parse protocols and ports
          const ports = pub.ports.map((v) => {
            const listenParts = v.listen.split("/");
            const forwardParts = v.forward ? v.forward.split("/") : listenParts;
            return {
              listenPort: parseInt(listenParts[0]),
              listenProtocol: listenParts[1],
              forwardPort: parseInt(forwardParts[0]),
              forwardProtocol: forwardParts[1],
              container: v.container ?? containers[0].name,
            };
          });

          // validate protocols are consistent
          const appProtocols = ports.filter(
            (port) =>
              ["http", "https"].includes(port.listenProtocol) &&
              ["http", "https"].includes(port.forwardProtocol),
          );
          if (appProtocols.length > 0 && appProtocols.length < ports.length)
            throw new VisibleError(
              `Protocols must be either all http/https, or all tcp/udp/tcp_udp/tls.`,
            );

          // validate certificate exists for https/tls protocol
          ports.forEach((port) => {
            if (["https", "tls"].includes(port.listenProtocol) && !pub.domain) {
              throw new VisibleError(
                `You must provide a custom domain for ${port.listenProtocol.toUpperCase()} protocol.`,
              );
            }
          });

          return ports;
        },
      );

      const domain = output(args.public).apply((pub) => {
        if (!pub.domain) return undefined;

        // normalize domain
        const domain =
          typeof pub.domain === "string" ? { name: pub.domain } : pub.domain;
        return {
          name: domain.name,
          dns: domain.dns === false ? undefined : domain.dns ?? awsDns(),
          cert: domain.cert,
        };
      });

      return { ports, domain };
    }

    function buildLinkData() {
      return output(args.link || []).apply((links) => Link.build(links));
    }

    function buildLinkPermissions() {
      return Link.getInclude<Permission>("aws.permission", args.link);
    }

    function createLoadBalancer() {
      if (!pub) return {};

      const securityGroup = new ec2.SecurityGroup(
        ...transform(
          args?.transform?.loadBalancerSecurityGroup,
          `${name}LoadBalancerSecurityGroup`,
          {
            vpcId: vpc.id,
            egress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
            ingress: [
              {
                fromPort: 0,
                toPort: 0,
                protocol: "-1",
                cidrBlocks: ["0.0.0.0/0"],
              },
            ],
          },
          { parent: self },
        ),
      );

      const loadBalancer = new lb.LoadBalancer(
        ...transform(
          args.transform?.loadBalancer,
          `${name}LoadBalancer`,
          {
            internal: false,
            loadBalancerType: pub.ports.apply((ports) =>
              ports[0].listenProtocol.startsWith("http")
                ? "application"
                : "network",
            ),
            subnets: vpc.loadBalancerSubnets,
            securityGroups: [securityGroup.id],
            enableCrossZoneLoadBalancing: true,
          },
          { parent: self },
        ),
      );

      const ret = all([pub.ports, certificateArn]).apply(([ports, cert]) => {
        const listeners: Record<string, lb.Listener> = {};
        const targets: Record<string, lb.TargetGroup> = {};

        ports.forEach((port) => {
          const container = port.container;
          const forwardProtocol = port.forwardProtocol.toUpperCase();
          const forwardPort = port.forwardPort;
          const targetId = `${container}${forwardProtocol}${forwardPort}`;
          const target =
            targets[targetId] ??
            new lb.TargetGroup(
              ...transform(
                args.transform?.target,
                `${name}Target${targetId}`,
                {
                  // TargetGroup names allow for 32 chars, but an 8 letter suffix
                  // ie. "-1234567" is automatically added.
                  // - If we don't specify "name" or "namePrefix", we need to ensure
                  //   the component name is less than 24 chars. Hard to guarantee.
                  // - If we specify "name", we need to ensure the $app-$stage-$name
                  //   if less than 32 chars. Hard to guarantee.
                  // - Hence we will use "namePrefix".
                  namePrefix: forwardProtocol,
                  port: forwardPort,
                  protocol: forwardProtocol,
                  targetType: "ip",
                  vpcId: vpc.id,
                },
                { parent: self },
              ),
            );
          targets[targetId] = target;

          const listenProtocol = port.listenProtocol.toUpperCase();
          const listenPort = port.listenPort;
          const listenerId = `${listenProtocol}${listenPort}`;
          const listener =
            listeners[listenerId] ??
            new lb.Listener(
              ...transform(
                args.transform?.listener,
                `${name}Listener${listenerId}`,
                {
                  loadBalancerArn: loadBalancer.arn,
                  port: listenPort,
                  protocol: listenProtocol,
                  certificateArn: ["HTTPS", "TLS"].includes(listenProtocol)
                    ? cert
                    : undefined,
                  defaultActions: [
                    {
                      type: "forward",
                      targetGroupArn: target.arn,
                    },
                  ],
                },
                { parent: self },
              ),
            );
          listeners[listenerId] = listener;
        });

        return { listeners, targets };
      });

      return { loadBalancer, targets: ret.targets };
    }

    function createSsl() {
      if (!pub) return output(undefined);

      return pub.domain.apply((domain) => {
        if (!domain) return output(undefined);
        if (domain.cert) return output(domain.cert);

        return new DnsValidatedCertificate(
          `${name}Ssl`,
          {
            domainName: domain.name,
            dns: domain.dns!,
          },
          { parent: self },
        ).arn;
      });
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
            containerDefinitions: $jsonStringify(
              containers.apply((containers) =>
                containers.map((container) => {
                  return {
                    name: container.name,
                    image: createImage(),
                    command: container.command,
                    entrypoint: container.entrypoint,
                    pseudoTerminal: true,
                    portMappings: [{ containerPortRange: "1-65535" }],
                    logConfiguration: {
                      logDriver: "awslogs",
                      options: {
                        "awslogs-group": createLogGroup().name,
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
                  };

                  function createImage() {
                    return container.image.apply((imageArgs) => {
                      if (typeof imageArgs === "string")
                        return output(imageArgs);

                      const contextPath = path.join(
                        $cli.paths.root,
                        imageArgs.context,
                      );
                      const dockerfile = imageArgs.dockerfile ?? "Dockerfile";
                      const dockerfilePath = imageArgs.dockerfile
                        ? path.join($cli.paths.root, imageArgs.dockerfile)
                        : path.join(
                            $cli.paths.root,
                            imageArgs.context,
                            "Dockerfile",
                          );
                      const dockerIgnorePath = fs.existsSync(
                        path.join(contextPath, `${dockerfile}.dockerignore`),
                      )
                        ? path.join(contextPath, `${dockerfile}.dockerignore`)
                        : path.join(contextPath, ".dockerignore");

                      // add .sst to .dockerignore if not exist
                      const lines = fs.existsSync(dockerIgnorePath)
                        ? fs
                            .readFileSync(dockerIgnorePath)
                            .toString()
                            .split("\n")
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
                          `${name}Image${container.name}`,
                          {
                            context: { location: contextPath },
                            dockerfile: { location: dockerfilePath },
                            buildArgs: imageArgs.args ?? {},
                            platforms: [imageArgs.platform],
                            tags: [
                              interpolate`${bootstrapData.assetEcrUrl}:${container.name}`,
                            ],
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
                        `${name}LogGroup${container.name}`,
                        {
                          name: interpolate`/sst/cluster/${cluster.name}/${name}/${container.name}`,
                          retentionInDays: container.logging.apply(
                            (logging) => RETENTION[logging.retention],
                          ),
                        },
                        { parent: self },
                      ),
                    );
                  }
                }),
              ),
            ),
          },
          { parent: self },
        ),
      );
    }

    function createCloudmapService() {
      return new servicediscovery.Service(
        `${name}CloudmapService`,
        {
          name: `${name}.${$app.stage}.${$app.name}`,
          namespaceId: vpc.cloudmapNamespaceId,
          forceDestroy: true,
          dnsConfig: {
            namespaceId: vpc.cloudmapNamespaceId,
            dnsRecords: [{ ttl: 60, type: "A" }],
          },
        },
        { parent: self },
      );
    }

    function createService() {
      return new ecs.Service(
        ...transform(
          args.transform?.service,
          `${name}Service`,
          {
            name,
            cluster: cluster.arn,
            taskDefinition: taskDefinition.arn,
            desiredCount: scaling.min,
            launchType: "FARGATE",
            networkConfiguration: {
              // If the vpc is an SST vpc, services are automatically deployed to the public
              // subnets. So we need to assign a public IP for the service to be accessible.
              assignPublicIp: isSstVpc,
              subnets: vpc.serviceSubnets,
              securityGroups: vpc.securityGroups,
            },
            deploymentCircuitBreaker: {
              enable: true,
              rollback: true,
            },
            loadBalancers:
              pub &&
              all([pub.ports, targets!]).apply(([ports, targets]) =>
                Object.values(targets).map((target) => ({
                  targetGroupArn: target.arn,
                  containerName: target.port.apply(
                    (port) =>
                      ports.find((p) => p.forwardPort === port)!.container,
                  ),
                  containerPort: target.port.apply((port) => port!),
                })),
              ),
            enableExecuteCommand: true,
            serviceRegistries: { registryArn: cloudmapService.arn },
          },
          { parent: self },
        ),
      );
    }

    function createAutoScaling() {
      const target = new appautoscaling.Target(
        `${name}AutoScalingTarget`,
        {
          serviceNamespace: "ecs",
          scalableDimension: "ecs:service:DesiredCount",
          resourceId: interpolate`service/${cluster.name}/${service.name}`,
          maxCapacity: scaling.max,
          minCapacity: scaling.min,
        },
        { parent: self },
      );

      new appautoscaling.Policy(
        `${name}AutoScalingCpuPolicy`,
        {
          serviceNamespace: target.serviceNamespace,
          scalableDimension: target.scalableDimension,
          resourceId: target.resourceId,
          policyType: "TargetTrackingScaling",
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: "ECSServiceAverageCPUUtilization",
            },
            targetValue: scaling.cpuUtilization,
          },
        },
        { parent: self },
      );

      new appautoscaling.Policy(
        `${name}AutoScalingMemoryPolicy`,
        {
          serviceNamespace: target.serviceNamespace,
          scalableDimension: target.scalableDimension,
          resourceId: target.resourceId,
          policyType: "TargetTrackingScaling",
          targetTrackingScalingPolicyConfiguration: {
            predefinedMetricSpecification: {
              predefinedMetricType: "ECSServiceAverageMemoryUtilization",
            },
            targetValue: scaling.memoryUtilization,
          },
        },
        { parent: self },
      );
    }

    function createDnsRecords() {
      if (!pub) return;

      pub.domain.apply((domain) => {
        if (!domain?.dns) return;

        domain.dns.createAlias(
          name,
          {
            name: domain.name,
            aliasName: loadBalancer!.dnsName,
            aliasZone: loadBalancer!.zoneId,
          },
          { parent: self },
        );
      });
    }

    function registerHint() {
      self.registerOutputs({ _hint: self._url });
    }

    function registerReceiver() {
      containers.apply((val) => {
        for (const container of val) {
          const title = val.length == 1 ? name : `${name}${container.name}`;
          new DevCommand(`${title}Dev`, {
            link: args.link,
            dev: {
              title,
              autostart: true,
              ...container.dev,
            },
            environment: {
              ...container.environment,
              AWS_REGION: region,
            },
          });
        }
      });
    }
  }

  /**
   * The URL of the service.
   *
   * If `public.domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated load balancer URL.
   */
  public get url() {
    const errorMessage =
      "Cannot access the URL because no public ports are exposed.";
    if ($dev) {
      if (!this.devUrl) throw new VisibleError(errorMessage);
      return this.devUrl;
    }

    if (!this._url) throw new VisibleError(errorMessage);
    return this._url;
  }

  /**
   * The name of the Cloud Map service.
   */
  public get service() {
    if ($dev) return interpolate`dev.${this.cloudmapNamespace}`;
    return interpolate`${this.cloudmapService!.name}.${this.cloudmapNamespace}`;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The Amazon ECS Service.
       */
      get service() {
        if ($dev)
          throw new VisibleError("Cannot access `nodes.service` in dev mode.");
        return self.service!;
      },
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
        if ($dev)
          throw new VisibleError(
            "Cannot access `nodes.taskDefinition` in dev mode.",
          );
        return self.taskDefinition!;
      },
      /**
       * The Amazon Elastic Load Balancer.
       */
      get loadBalancer() {
        if ($dev)
          throw new VisibleError(
            "Cannot access `nodes.loadBalancer` in dev mode.",
          );
        if (!self.loadBalancer)
          throw new VisibleError(
            "Cannot access `nodes.loadBalancer` when no public ports are exposed.",
          );
        return self.loadBalancer;
      },
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: $dev ? this.devUrl : this._url,
        service: this.service,
      },
    };
  }
}

const __pulumiType = "sst:aws:Service";
// @ts-expect-error
Service.__pulumiType = __pulumiType;

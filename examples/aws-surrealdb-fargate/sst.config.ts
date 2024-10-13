/// <reference path="./.sst/platform/config.d.ts" />

// Credentials
const SURREAL_USERNAME = "root";
const SURREAL_PASSWORD = "root";
const SURREAL_NAMESPACE = "test";
const SURREAL_DATABASE = "test";

// Network
const CONTAINER_PORT = 8080;

/**
 * ## Surrealdb in AWS [Fargate with EFS]
 * _A low cost setup **not recommended for production**!_
 *
 * You can use SST to deploy containers with persisting volumes, such as EFS.
 *
 * Features included in this setup:
 * * `fck-nat` for much cheaper connectivity
 * * EFS for flexible persistent volumes
 * * Fargate Spot has preference over Fargate, reducing direct hosting costs.
 */
export default $config({
  app(input) {
    return {
      name: "aws-surrealdb",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-2",
        },
      },
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("MyVpc", {
      bastion: true,
      nat: "ec2",
      az: 1,
      transform: {
        vpc: {
          enableDnsHostnames: true,
          enableDnsSupport: true,
        },
      },
    });

    // Service

    const cluster = new sst.aws.Cluster("MyCluster", { vpc });

    const efsVolume = new aws.efs.FileSystem("surrealdb-volume", {
      performanceMode: "maxIO",
      encrypted: true,
    });

    const efsAccessPoint = new aws.efs.AccessPoint("surrealdb-access-point", {
      fileSystemId: efsVolume.id,
      rootDirectory: {
        path: "/surrealdb",
        creationInfo: {
          ownerUid: 1000,
          ownerGid: 1000,
          permissions: "755",
        },
      },
      posixUser: { uid: 1000, gid: 1000 },
    });

    new aws.efs.MountTarget("surrealdb-mount-target", {
      fileSystemId: efsVolume.id,
      subnetId: vpc.privateSubnets.apply((subnets) => subnets[0]),
    });

    const service = cluster.addService("SurrealDB", {
      architecture: "arm64",
      containers: [
        {
          name: "surrealdb",
          image: "surrealdb/surrealdb:v2.0.2",
          command: [
            "start",
            "--bind",
            `0.0.0.0:${CONTAINER_PORT}`,
            "--log",
            "info",
            "--user",
            SURREAL_USERNAME,
            "--pass",
            SURREAL_PASSWORD,
            "surrealkv://data/data.skv",
            "--allow-scripting",
          ],
          mountPoints: [
            {
              sourceVolume: "surrealdb-volume",
              containerPath: "/data",
              readOnly: false,
            },
          ],
        },
      ],
      transform: {
        taskDefinition: {
          volumes: [
            {
              name: "surrealdb-volume",
              efsVolumeConfiguration: {
                fileSystemId: efsVolume.id,
                transitEncryption: "ENABLED",
                authorizationConfig: {
                  accessPointId: efsAccessPoint.id,
                  iam: "ENABLED",
                },
              },
            },
          ],
        },
        service: {
          launchType: undefined,
          capacityProviderStrategies: [
            {
              capacityProvider: "FARGATE_SPOT",
              weight: 100,
              base: 1,
            },
            {
              capacityProvider: "FARGATE",
              weight: 1,
            },
          ],
        },
      },
    });

    const surrealEndpoint = service.service.apply(
      (hostname) => `http://${hostname}:${CONTAINER_PORT}`
    );

    // Lambda
    const client = new sst.aws.Function("MyFunction", {
      vpc,
      url: true,
      handler: "client.handler",
      environment: {
        SURREAL_USERNAME,
        SURREAL_PASSWORD,
        SURREAL_NAMESPACE,
        SURREAL_DATABASE,
        SURREAL_ENDPOINT: surrealEndpoint,
      },
    });

    return {
      database: surrealEndpoint,
      client: client.url,
    };
  },
});

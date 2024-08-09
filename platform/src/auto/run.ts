import { Link } from "../components/link";
import {
  ResourceTransformationArgs,
  interpolate,
  mergeOptions,
  runtime,
  automation,
  output,
} from "@pulumi/pulumi";

import { VisibleError } from "../components/error";
import { dynamodb } from "@pulumi/aws";
import { Linkable } from "../components";
import { permission } from "../components/aws/permission.js";

export async function run(program: automation.PulumiFn) {
  process.chdir($cli.paths.root);

  addTransformationToRetainResourcesOnDelete();
  addTransformationToAddTags();
  addTransformationToCheckBucketsHaveMultiplePolicies();

  Linkable.wrap(dynamodb.Table, (item) => ({
    properties: { tableName: item.name },
    include: [
      permission({
        actions: ["dynamodb:*"],
        resources: [item.arn, interpolate`${item.arn}/*`],
      }),
    ],
  }));
  Link.reset();
  const outputs = (await program()) || {};
  return outputs;
}

function addTransformationToRetainResourcesOnDelete() {
  runtime.registerStackTransformation((args: ResourceTransformationArgs) => {
    if (
      $app.removal === "retain-all" ||
      ($app.removal === "retain" &&
        [
          "aws:s3/bucket:Bucket",
          "aws:s3/bucketV2:BucketV2",
          "aws:dynamodb/table:Table",
        ].includes(args.type))
    ) {
      return {
        props: args.props,
        opts: mergeOptions({ retainOnDelete: true }, args.opts),
      };
    }
    return undefined;
  });
}

function addTransformationToAddTags() {
  runtime.registerStackTransformation((args: ResourceTransformationArgs) => {
    if ("import" in args.opts && args.opts.import) {
      if (!args.opts.ignoreChanges) args.opts.ignoreChanges = [];
      args.opts.ignoreChanges.push("tags");
      args.opts.ignoreChanges.push("tagsAll");
    }
    return args;
  });
}

function addTransformationToCheckBucketsHaveMultiplePolicies() {
  const bucketsWithPolicy: Record<string, string> = {};
  runtime.registerStackTransformation((args: ResourceTransformationArgs) => {
    if (args.type !== "aws:s3/bucketPolicy:BucketPolicy") return;

    output(args.props.bucket).apply((bucket: string) => {
      if (bucketsWithPolicy[bucket])
        throw new VisibleError(
          `Cannot add bucket policy "${args.name}" to the AWS S3 Bucket "${bucket}". The bucket already has a policy attached "${bucketsWithPolicy[bucket]}".`,
        );

      bucketsWithPolicy[bucket] = args.name;
    });

    return undefined;
  });
}

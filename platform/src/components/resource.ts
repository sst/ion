import { output } from "@pulumi/pulumi";
import { Link } from "./link";
import { Component } from "./component";

export class Resource<T extends Record<string, any>>
  extends Component
  implements Link.Linkable
{
  private _properties: T;
  private _name: string;
  private _include: NonNullable<Link.Definition["include"]>;

  constructor(
    name: string,
    properties: T,
    ...include: NonNullable<Link.Definition["include"]>
  ) {
    super(
      "sst:sst:Resource",
      name,
      {
        properties,
      },
      {},
    );
    this._include = include;
    this._properties = properties;
    this._name = name;
  }

  public get name() {
    return output(this._name);
  }

  public get properties() {
    return this._properties as T;
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: this._properties,
      include: this._include,
    };
  }
}



new sst.Linkable("MyThing", {
  properties: {
    instanceId: rdsInstance.id,
    clusterId: rdsCluster.clusterId,
  },
  include: [
    sst.aws.permission({
      actions: ["foo:*"],
      resources: [rdsInstance.arn],
    })
  ]
})

sst.Linkable.wrap(Thing, (resource) => ({
  properties: { ... },
  include: [
    sst.aws.permission({ actions: ["foo:*"], resources: [resource.arn] })
  ]
}))

// sst shell <script> --stage=production
// command.dev: go run main.go
// sst run --stage=production --target=SSH go run main.go
//
// sst dev <cmd> <- this should be rare

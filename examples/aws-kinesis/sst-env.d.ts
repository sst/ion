/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    MyApp: {
      name: string
      type: "sst.aws.Function"
      url: string
    }
    MyStream: {
      arn: string
      name: string
      type: "sst.aws.Kinesis"
    }
  }
}
export {}
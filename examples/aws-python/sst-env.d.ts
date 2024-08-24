/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    "MyNodeFunction": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
    "MyPythonFunction": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
  }
}
export {}

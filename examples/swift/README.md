# ❍ Swift Example

Deploy Swift applications using sst ion.

## Build

Building your application for deployment requires installing Docker.

When deploying with `sst deploy` your application will be build for Amazon Linux, ensuring its campatible with the AWS Lambda provided runtime.

## Deploy

Deploy just like any other sst project:

```sh
sst deploy --stage production
```

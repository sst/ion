# ❍ Swift Example

Deploy Swift applications using sst ion.

## Build

Building your application for deployment requires installing Docker. Before deploying you must run:

```sh
make build
```

This will build your application for Amazon Linux, ensuring its campatible with AWS Lambda provided runtime.

## Deploy

After you build your application you can deploy just like any other sst project:

```sh
sst deploy --stage production
```

---
title: Set up a Monorepo
description: A TypeScript monorepo setup for your app.
---

While, [drop-in mode](/docs/#drop-in-mode) is great for simple projects, we recommend using a monorepo for projects that are going to have multiple packages.

:::tip
We created a [monorepo template](https://github.com/sst/monorepo-template/tree/main) for your SST projects.
:::

However, setting up a monorepo with everything you need can be surprisingly tricky. To fix this we created a template for a TypeScript monorepo that uses npm workspaces.

---

## How to use

To use this template.

1. Head over to [**github.com/sst/monorepo-template**](https://github.com/sst/monorepo-template)

2. Click on **Use this template** and create a new repo

3. Clone the repo

4. From the project root, run the following to rename it to your app

   ```bash
   npx replace-in-file /monorepo-template/g MY_APP **/*.* --verbose
   ```

5. Install the dependencies

   ```bash
   npm install
   ```

Now just run `npx sst dev` from the project root.

---

## Project structure

The app is split into the separate `packages/` and an `infra/` directory.

```txt {2}
my-sst-app
├─ sst.config.ts
├─ package.json
├─ packages
│  ├─ frontend
│  ├─ scripts
│  └─ core
└─ infra
```

The `packages/` directory has your workspaces and this is in the root `package.json`.

```json title="package.json
"workspaces": [
  "packages/*"
]
```

Let's look at it in detail. 

---

### Packages

The `packages/` directory  includes the following:

- `core/`

  This directory includes shared code that can be used by other packages. These are
  defined as modules. For example, we have an `Example` module.

  ```ts title="packages/core/src/example/index.ts"
  export module Example {
    export function hello() {
      return "Hello, world!";
    }
  }
  ```

  We export this using the following in the `package.json`:

  ```json title="packages/core/package.json"
  "exports": {
    "./*": [
      "./src/*\/index.ts",
      "./src/*.ts"
    ]
  }
  ```

  This will allow us to import the `Example` module by doing:

  ```ts
  import { Example } from "@monorepo-template/core/example";

  Example.hello();
  ```

  We recommend creating new modules for the various _domains_ in your project. This roughly follows Domain Driven Design.

- `functions/`

  This directory includes our Lambda functions. It imports from the `core/`
  package by using it as a local dependency.

- `scripts/`

  This directory includes scripts that you can run on your SST app using the `sst shell` CLI
  and [`tsx`](https://www.npmjs.com/package/tsx). For example, to the run the example
  `scripts/src/example.ts`, run the following from `packages/scripts/`.

  ```bash
  npm run shell src/example.ts
  ```

---

### Infrastructure

The `infra/` directory allows you to logically split the infrastructure of your app into separate files. This can be helpful as your app grows.

In the template, we have an `api.ts`, and `storage.ts`. These export resources that can be used in the other infrastructure files.

```ts title="infra/storage.ts"
export const bucket = new sst.aws.Bucket("MyBucket");
```

We then dynamically import them in the `sst.config.ts`.

```ts title="sst.config.ts"
async run() {
  await import("./infra/storage");
  const api = await import("./infra/api");

  return {
    api: api.myApi.url
  };
}
```

Finally, some of the outputs of our components are set as outputs for our app.

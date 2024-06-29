import * as path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === "edge") {
      // Ensure sst uses Node's process module and not a popular shim package when compiling middleware.
      config.resolve.alias.process = path.resolve("node:process");
    }
    return config;
  },
};

export default nextConfig;

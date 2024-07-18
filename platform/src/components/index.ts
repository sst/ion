export * as aws from "./aws";
export * as cloudflare from "./cloudflare";
export * as vercel from "./vercel";
export * from "./secret";
export * from "./resource";

import { Link } from "./link.js";
export const linkable = Link.linkable;

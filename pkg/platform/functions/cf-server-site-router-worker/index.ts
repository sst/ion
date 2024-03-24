declare global {
  const origins: Record<string, {
    originId: string;
    domainName: string;
  }>;
  const behaviors: Array< {
    pattern: string;
    origin: string;
  }>;
}

import type {R2Bucket, R2ObjectBody} from "@cloudflare/workers-types"

export interface Env {
  ASSETS: R2Bucket;
  middleware: {
    fetch: typeof fetch;
  }
}

function matchGlobPattern(globPattern: string, path: string) {
  // Convert glob pattern to a regular expression
  const regexPattern = globPattern
    .replace(/\*\*/g, '.*') // Replace '**' with '.*' (matches any subdirectory levels)
    .replace(/\*/g, '[^/]*'); // Replace '*' with '[^/]*' (matches any characters except '/')
  
  const regex = new RegExp(`^${regexPattern}$`);

  // Test if the path matches the regex
  return regex.test(path);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/^\//, "");
    const filePath = pathname;

    // Return from cache if available
    let cachedResponse = await lookupCache();
    if (cachedResponse) return cachedResponse;

    // Fetch from R2
    const object = await env.ASSETS.get(filePath !== "" ? filePath : "index.html");
    if (object) return await respond(200, object);

    if(filePath.startsWith("_next/image")) {
      return await fetch(`https://${origins["imageOptimizer"].domainName}${pathname}`)
    }else {
      const newRequest = new Request(request)
      newRequest.headers.set("x-forwarded-host", request.headers.get("host") ?? "");
      return await env.middleware.fetch(newRequest);
    }

    async function lookupCache() {
      const cache = caches.default;
      const hash = AssetManifest[filePath];
      const cacheKey = `${request.url}-${hash}`;
      if (cacheKey) {
        return await cache.match(cacheKey);
      }
    }

    async function setCache(response: Response) {
      const cache = caches.default;
      const hash = AssetManifest[filePath];
      const cacheKey = `${request.url}-${hash}`;
      if (cacheKey) {
        await cache.put(cacheKey, response.clone());
      }
    }

    async function respond(
      status: number,
      object: R2ObjectBody,
    ) {
      // build response
      const headers = new Headers();
      headers.set("Content-Type", object.httpMetadata?.contentType ?? "text/plain");
      headers.set("Cache-Control", object.httpMetadata?.cacheControl ?? "public, max-age=3600");
      headers.set("ETag", object.httpEtag);
      const response = new Response(object.body, {
        status,
        headers,
      });

      // set cache
      await setCache(response);

      return response;
    }
  },
};

// More examples here on how to parse responses from Cloudflare API
// https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/routes.ts

const CLOUDFLARE_API_BASE_URL =
  process.env.CLOUDFLARE_API_BASE_URL ?? "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const AUTH = getAuth() as any;

export interface FetchError {
  code: number;
  message: string;
  error_chain?: FetchError[];
}

export interface FetchResult<ResultType> {
  success: boolean;
  result: ResultType;
  errors: FetchError[];
  messages?: string[];
  result_info?: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
  };
}

export async function cfFetch<ResultType>(
  resource: string,
  init: RequestInit = {},
) {
  const ret = await fetch(`${CLOUDFLARE_API_BASE_URL}${resource}`, {
    ...init,
    headers: {
      ...AUTH,
      ...init.headers,
    },
  });
  const json = (await ret.json()) as FetchResult<ResultType>;
  // ie.
  // {
  //   "result": {
  //     "subdomain": "wangfanjie"
  //   },
  //   "success": true,
  //   "errors": [],
  //   "messages": []
  // }
  if (json.success) {
    return json;
  }

  const error = new Error(
    `A request to the Cloudflare API (${resource}) failed.`,
  );
  // @ts-expect-error attach the errors to the error object
  error.errors = json.errors;
  // @ts-expect-error attach the messages to the error object
  error.messages = json.messages;
  throw error;
}


function getAuth() {
  if (CLOUDFLARE_API_TOKEN) {
    return {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
    };
  } else if (CLOUDFLARE_EMAIL && CLOUDFLARE_API_KEY) {
    return {
      "X-Auth-Email": CLOUDFLARE_EMAIL,
      "X-Auth-Key": CLOUDFLARE_API_KEY,
    };
  } else {
    throw new Error("No Cloudflare API token or email/key pair found.");
  }
}

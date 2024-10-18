import { Cluster } from "ioredis";
import { Resource } from "sst";

const client = new Cluster(
  [
    {
      host: Resource.MyRedis.host,
      port: Resource.MyRedis.port,
    },
  ],
  {
    redisOptions: {
      tls: {
        checkServerIdentity: () => undefined,
      },
      username: Resource.MyRedis.username,
      password: Resource.MyRedis.password,
    },
  }
);

export async function handler() {
  await client.set("foo", `bar-${Date.now()}`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      foo: await client.get("foo"),
    }),
  };
}

import { APIGatewayProxyEventV2 } from "aws-lambda";

export const handler = awslambda.streamifyResponse(
  async (evt: APIGatewayProxyEventV2, responseStream) => {
    const httpResponseMetadata = {
      statusCode: 200,
      headers: {
        "Transfer-Encoding": "chunked",
      },
    };
    const size = parseInt(evt.queryStringParameters?.size || "10");
    const chunk = parseInt(evt.queryStringParameters?.chunk || "1");
    const delay = parseInt(evt.queryStringParameters?.delay || "100");
    const writer = awslambda.HttpResponseStream.from(
      responseStream,
      httpResponseMetadata,
    );
    const data = new Uint8Array(Buffer.from("0".repeat(size)));
    if (chunk === 0) {
      responseStream.write(data);
      writer.end();
      return;
    }

    writer.write("");
    for (let i = 0; i < Math.ceil(data.length / chunk); i += chunk) {
      const sub = data.subarray(i, i + chunk);
      writer.write(sub, "utf8");
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    writer.end();
  },
);

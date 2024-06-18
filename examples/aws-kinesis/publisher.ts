import { KinesisClient, PutRecordCommand } from "@aws-sdk/client-kinesis";
import { Resource } from "sst";

export const handler = async (event) => {
  const client = new KinesisClient();
  const blob = new Blob([JSON.stringify({ Hello: "World" })], {
    type: "application/json",
  });
  const arrayBuffer = new Uint8Array(await blob.arrayBuffer());

  await client.send(
    new PutRecordCommand({
      Data: arrayBuffer,
      StreamARN: Resource.MyStream.arn,
      StreamName: Resource.MyStream.name,
      PartitionKey: "1",
    })
  );

  const blobFiltered = new Blob(
    [JSON.stringify({ Hello: "World", type: "filter" })],
    {
      type: "application/json",
    }
  );

  const arrayBufferFiltered = new Uint8Array(await blobFiltered.arrayBuffer());

  await client.send(
    new PutRecordCommand({
      Data: arrayBufferFiltered,
      StreamARN: Resource.MyStream.arn,
      StreamName: Resource.MyStream.name,
      PartitionKey: "1",
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ status: "sent" }, null, 2),
  };
};

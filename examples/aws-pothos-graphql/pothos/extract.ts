import { writeFileSync } from "fs";
import { printSchema, lexicographicSortSchema } from "graphql";
import { schema } from "./schema";

async function extract() {
  const schemaAsString = printSchema(lexicographicSortSchema(schema));
  writeFileSync("graphql/schema.graphql", schemaAsString);
  require("child_process").execSync(
    `cd graphql && npx @genql/cli --output ./genql --schema ./schema.graphql --esm`
  );
}

extract()
  .then(() => {
    console.log("Pothos schema extracted successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to extract pothos schema the database:", error);
    process.exit(1);
  });

import Surreal from "surrealdb";

export const handler = async () => {
  console.log(`Connecting to`, process.env.SURREAL_ENDPOINT);

  const db = new Surreal();
  await db.connect(process.env.SURREAL_ENDPOINT);

  await db.use({
    namespace: process.env.SURREAL_NAMESPACE,
    database: process.env.SURREAL_DATABASE,
  });

  await db.signin({
    username: process.env.SURREAL_USERNAME,
    password: process.env.SURREAL_PASSWORD,
  });

  await db.query(`INSERT INTO blog {
    text: "Hello, World!",
    when: time::now()
  }`);

  return {
    statusCode: 200,
    body: JSON.stringify(await db.query(`SELECT * FROM blog`)),
  };
};

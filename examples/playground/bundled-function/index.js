export const handler = async (evt) => {
  console.log(evt);
  return {
    statusCode: 200,
    body: JSON.stringify({ evt, web }),
  };
};

const config = {
  default: {
    override: {
      wrapper: "aws-lambda-streaming", // This is necessary to enable lambda streaming
    },
  },
};
export default config;

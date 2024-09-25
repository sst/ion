/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: "aws-python",
			removal: input?.stage === "production" ? "retain" : "remove",
			home: "local",
			providers: {
				aws: true,
			},
		};
	},
	async run() {
		const pythonNormal = new sst.aws.Function("FunctionA", {
			handler: "packages/function-a/src/python.handler",
			runtime: "python3.11",
			url: true,
		});

		const pythonDocker = new sst.aws.Function("FunctionADocker", {
			handler: "packages/function-a/src/python.handler",
			runtime: "python3.11",
			python: {
				container: true,
			},
			url: true,
		});

		return {
			pythonNormal: pythonNormal.url,
			pythonDocker: pythonDocker.url,
		};
	},
});

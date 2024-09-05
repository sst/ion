import { createInterface } from "readline";
import { stdin as input, stdout as output } from "process";

const plugins = await import(process.argv[2]);

const onResolve = [];
const onLoad = [];

const stubAPI = {
  onResolve(options, callback) {
    onResolve.push({ options, callback });
  },
  onLoad(options, callback) {
    onLoad.push({ options, callback });
  },
};

for (const plugin of plugins.default) {
  plugin.setup(stubAPI);
}

const rl = createInterface({ input, output, terminal: false });

rl.on("line", (line) => {
  const request = JSON.parse(line);
  let result;

  if (request.type === "resolve") {
    for (const { options, callback } of onResolve) {
      if (new RegExp(options.filter).test(request.path)) {
        result = callback(request);
        if (result) break;
      }
    }
  } else if (request.type === "load") {
    for (const { options, callback } of onLoad) {
      if (new RegExp(options.filter).test(request.path)) {
        result = callback(request);
        if (result) break;
      }
    }
  }

  output.write(JSON.stringify(result || {}) + "\n");
});

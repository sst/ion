
import { exec } from "child_process";

export function getNpmVersion() {
  return new Promise((resolve, reject) => {
    exec("npm --version", (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr) {
        reject(stderr);
        return;
      }
      const [major, minor, patch] = stdout.trim().split(".").map(Number);
      resolve({ major, minor, patch });
    });
  });
}
import { exec } from "child_process";

export function getNpmVersion(
  cwd: string
): Promise<Record<"major" | "minor" | "patch", number>> {
  return new Promise((resolve, reject) => {
    exec("npm --version", { cwd }, (error, stdout, stderr) => {
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

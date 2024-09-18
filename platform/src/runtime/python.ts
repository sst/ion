import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import pulumi from "@pulumi/pulumi";
import fsSync from "fs";
import { Semaphore } from "../util/semaphore.js";
import { FunctionArgs } from "../components/aws/function.js";
import { findAbove } from "../util/fs.js";

const limiter = new Semaphore(
	parseInt(process.env.SST_BUILD_CONCURRENCY || "4"),
);

export async function buildPythonContainer(
	name: string,
	input: pulumi.Unwrap<FunctionArgs> & {
		links?: {
			name: string;
			properties: any;
		}[];
	},
): Promise<
	| {
			type: "success";
			out: string;
			handler: string;
	  }
	| { type: "error"; errors: string[] }
> {
	const out = path.join($cli.paths.work, "artifacts", `${name}-src`);
	await fs.rm(out, { recursive: true, force: true });
	await fs.mkdir(out, { recursive: true });

	const parsed = path.parse(input.handler);
	const file = path.join(parsed.dir, `${parsed.name}.py`);
	if (!fsSync.existsSync(file)) {
		return {
			type: "error",
			errors: [`Could not find file for handler "${input.handler}"`],
		};
	}

	// Calculate the relative path from the project root to the handler's directory
	const relativePath = path.relative($cli.paths.root, parsed.dir);

	// Target directory should preserve the relative path
	const targetDir = path.join(out, relativePath);
	await fs.mkdir(targetDir, { recursive: true });

	try {
		await limiter.acquire(name);

		// Find the closest pyproject.toml
		const pyProjectFile = await findAbove(parsed.dir, "pyproject.toml");
		if (!pyProjectFile) {
			return {
				type: "error",
				errors: [
					`Could not find pyproject.toml for handler "${input.handler}"`,
				],
			};
		}

		// Copy pyproject.toml to the output directory
		await fs.copyFile(
			path.join(pyProjectFile, "pyproject.toml"),
			path.join(out, path.join(pyProjectFile, "pyproject.toml")),
		);

		// Check for uv.lock and copy it if it exists
		const uvLockFile = path.join(pyProjectFile, "uv.lock");
		if (fsSync.existsSync(uvLockFile)) {
			await fs.copyFile(uvLockFile, path.join(out, uvLockFile));
		}

		// At the level of the pyproject.toml file write a resources.json file
		const resourcesFile = path.join(out, pyProjectFile, "resources.json");
		await writeResourcesFile(resourcesFile, input.links || []);

		// Copy all Python files to the target directory, preserving structure
		const { pythonFiles, rootDir } = await getPythonFiles(parsed.dir);
		await copyFilesPreservingStructure(
			pythonFiles,
			rootDir,
			targetDir,
			parsed.dir,
		);

		// Check for dockerfile and copy it if it exists
		const dockerFile = path.join(pyProjectFile, "Dockerfile");
		if (fsSync.existsSync(dockerFile)) {
			await fs.copyFile(dockerFile, path.join(out, "Dockerfile"));
		} else {
			await fs.copyFile(
				path.join(
					$cli.paths.platform,
					"functions",
					"docker",
					"python.Dockerfile",
				),
				path.join(out, "Dockerfile"),
			);
		}

		return {
			type: "success",
			out,
			handler: path
				.join(relativePath, parsed.base)
				.split(path.sep)
				.join(path.posix.sep),
		};
	} catch (ex: any) {
		return {
			type: "error",
			errors: [ex.toString()],
		};
	} finally {
		limiter.release();
	}
}

export async function buildPython(
	name: string,
	input: pulumi.Unwrap<FunctionArgs> & {
		links?: {
			name: string;
			properties: any;
		}[];
	},
): Promise<
	| {
			type: "success";
			out: string;
			handler: string;
	  }
	| { type: "error"; errors: string[] }
> {
	const out = path.join($cli.paths.work, "artifacts", `${name}-src`);
	await fs.rm(out, { recursive: true, force: true });
	await fs.mkdir(out, { recursive: true });

	const parsed = path.parse(input.handler);
	const file = path.join(parsed.dir, `${parsed.name}.py`);
	if (!fsSync.existsSync(file)) {
		return {
			type: "error",
			errors: [`Could not find file for handler "${input.handler}"`],
		};
	}

	// Calculate the relative path from the project root to the handler's directory
	const relativePath = path.relative($cli.paths.root, parsed.dir);

	// Target directory should preserve the relative path
	const targetDir = path.join(out, relativePath);
	await fs.mkdir(targetDir, { recursive: true });

	try {
		await limiter.acquire(name);

		// Find the closest pyproject.toml
		const pyProjectFile = await findAbove(parsed.dir, "pyproject.toml");
		if (!pyProjectFile) {
			return {
				type: "error",
				errors: [
					`Could not find pyproject.toml or requirements.txt for handler "${input.handler}"`,
				],
			};
		}

		// Copy pyproject.toml to the output directory
		await fs.copyFile(
			path.join(pyProjectFile, "pyproject.toml"),
			path.join(out, path.join(pyProjectFile, "pyproject.toml")),
		);

		// If uv.lock exists, copy it to the output directory
		const uvLockFile = path.join(pyProjectFile, "uv.lock");
		if (fsSync.existsSync(uvLockFile)) {
			await fs.copyFile(uvLockFile, path.join(out, uvLockFile));
		}

		// At the same level as the pyproject.toml create resources.json
		const resourcesFile = path.join(pyProjectFile, "resources.json");
		await writeResourcesFile(resourcesFile, input.links || []);

		// Copy all Python files to the target directory, preserving structure
		const { pythonFiles, rootDir } = await getPythonFiles(parsed.dir);
		await copyFilesPreservingStructure(
			pythonFiles,
			rootDir,
			targetDir,
			parsed.dir,
		);

		// Install Python dependencies
		// in the output directory we run uv sync to create a virtual environment
		// first make the output directory the working directory
		// also need to use sst uv path because it is not guaranteed to be in the path
		const installCmd = `cd ${path.join(out, pyProjectFile)} && uv sync`;

		// Once the packages are synced, we need to convert the virtual environment to site-packages so that lambda can find the packages
		const sitePackagesCmd = `cp -r ${path.join(
			out,
			pyProjectFile,
			".venv",
			"lib",
			"python3.*",
			"site-packages",
			"*",
		)} ${out}`;

		// Now remove the virtual environment because it does not need to be included in the zip
		const removeVirtualEnvCmd = `rm -rf ${path.join(
			out,
			pyProjectFile,
			".venv",
		)}`;

		const command = `${installCmd} && ${sitePackagesCmd} && ${removeVirtualEnvCmd}`;

		await new Promise<void>((resolve, reject) => {
			exec(command, { cwd: out }, (error) => {
				if (error) {
					return reject(error);
				}
				resolve();
			});
		});

		return {
			type: "success",
			out,
			handler: path
				.join(relativePath, parsed.base)
				.split(path.sep)
				.join(path.posix.sep),
		};
	} catch (ex: any) {
		return {
			type: "error",
			errors: [ex.toString()],
		};
	} finally {
		limiter.release();
	}
}

/**
 * Recursively retrieves all Python files (.py and .pyi) from the directory of the given file path,
 * excluding any directories named "__pycache__".
 *
 * @param filePath - The path to the file whose directory will be searched.
 * @returns A promise that resolves to an array of Python file paths and the root directory.
 * @throws An error if the absolute path cannot be determined or if there's an issue walking the directory.
 */
async function getPythonFiles(
	filePath: string,
): Promise<{ pythonFiles: string[]; rootDir: string }> {
	try {
		console.log(`Getting Python files from ${filePath}`);

		// Get the absolute path of the file
		const absPath = path.resolve(filePath);

		console.log(`Absolute path: ${absPath}`);

		// Get the directory of the file
		const dir = path.dirname(absPath);

		console.log(`Directory: ${dir}`);

		const pythonFiles: string[] = [];

		/**
		 * Recursively walks through the directory and its subdirectories to find Python files.
		 *
		 * @param currentPath - The current directory path being walked.
		 */
		async function walkDirectory(currentPath: string): Promise<void> {
			let entries: fsSync.Dirent[];

			try {
				entries = await fs.readdir(currentPath, { withFileTypes: true });
			} catch (err) {
				// If there's an error accessing the path, skip it
				console.warn(
					`Warning: Unable to access ${currentPath}. Skipping. Error: ${(err as Error).message}`,
				);
				return;
			}

			for (const entry of entries) {
				const entryPath = path.join(currentPath, entry.name);

				if (entry.isDirectory()) {
					if (entry.name === "__pycache__") {
						// Skip directories named "__pycache__"
						continue;
					}
					// Recursively walk the subdirectory
					await walkDirectory(entryPath);
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase();
					if (ext === ".py" || ext === ".pyi") {
						pythonFiles.push(entryPath);
					}
				}
			}
		}

		// Start walking from the directory
		await walkDirectory(dir);

		return { pythonFiles, rootDir: dir };
	} catch (error) {
		throw new Error(`Error in getPythonFiles: ${(error as Error).message}`);
	}
}

/**
 * Copies the given Python files to the destination directory, preserving their directory structure relative to the source root.
 *
 * @param pythonFiles - An array of absolute paths to Python files.
 * @param sourceRoot - The root directory from which the files are being copied.
 * @param destinationRoot - The directory where the files will be copied to.
 * @returns A promise that resolves when all files have been copied.
 * @throws An error if any file operations fail.
 */
async function copyFilesPreservingStructure(
	pythonFiles: string[],
	sourceRoot: string,
	destinationRoot: string,
	baseDir?: string,
): Promise<void> {
	try {
		console.log(`Source root: ${sourceRoot}`);
		console.log(`Destination root: ${destinationRoot}`);

		const dest = baseDir
			? destinationRoot.slice(0, -baseDir.length)
			: destinationRoot;
		console.log(`Destination root: ${dest}`);

		for (const filePath of pythonFiles) {
			// Determine the relative path from the source root
			const relativePath = path.relative(sourceRoot, filePath);

			// Determine the destination path
			const destPath = path.join(dest, relativePath);

			// Ensure the destination directory exists
			const destDir = path.dirname(destPath);
			await fs.mkdir(destDir, { recursive: true });

			// Copy the file
			await fs.copyFile(filePath, destPath);

			// console.log(`Copied: ${filePath} -> ${destPath}`);
		}
	} catch (error) {
		throw new Error(
			`Error in copyFilesPreservingStructure: ${(error as Error).message}`,
		);
	}
}

async function writeResourcesFile(
	resourcesFile: string,
	links: {
		name: string;
		properties: any;
	}[],
): Promise<void> {
	// {
	// 	"MyLinkableValue": {
	// 		"foo": "Hello World",
	// 		"type": "sst:sst:Linkable"
	// 	}
	// }

	// Convert the links array to a map
	const linksMap = new Map<string, any>();
	for (const link of links) {
		linksMap.set(link.name, link.properties);
	}

	// Write JSON to the resources file
	await fs.writeFile(
		resourcesFile,
		JSON.stringify(Object.fromEntries(linksMap), null, 2),
		{ encoding: "utf-8" },
	);
}

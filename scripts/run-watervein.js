#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = path.resolve(SCRIPT_DIR, "..");
const FRAMEWORKS = [
  "keyed/vanillajs",
  "keyed/vanjs",
  "keyed/react-hooks",
  "keyed/preact-hooks",
  "keyed/mikado",
  "keyed/vue",
  "keyed/solid",
  "keyed/svelte",
  "keyed/watervein",
];
const WATERVEIN_PACKAGES = ["core", "dom-core", "dom"];
const CHROME_VERSION = "150.0.7871.46";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " exited with status " + result.status);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function ensureChrome(waterveinDir) {
  const configuredBinary = process.env.CHROME_BINARY;
  const candidates = configuredBinary
    ? [configuredBinary]
    : process.platform === "win32"
      ? ["chrome.exe", "chrome"]
      : ["google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"];

  for (const candidate of candidates) {
    const binary =
      path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")
        ? path.resolve(waterveinDir, candidate)
        : candidate;
    const versionOutput = spawnSync(binary, ["--version"], { encoding: "utf8" });
    if (versionOutput.error || versionOutput.status !== 0) continue;

    const actualVersion = (versionOutput.stdout + versionOutput.stderr).trim();
    console.log(actualVersion);
    if (!actualVersion.includes(CHROME_VERSION)) {
      throw new Error("Expected Chrome " + CHROME_VERSION + ", but found: " + actualVersion);
    }
    return binary;
  }

  throw new Error(
    "Chrome for Testing " + CHROME_VERSION +
      " was not found. Install it and add it to PATH, or set CHROME_BINARY to its executable path.",
  );
}

async function ensureServer() {
  const url = "http://127.0.0.1:8080/ls";
  try {
    const response = await fetch(url);
    if (response.ok) {
      console.log("Reusing the benchmark server already listening on port 8080.");
      return;
    }
  } catch {
    // Start the server below.
  }

  console.log("Starting the js-framework-benchmark server...");
  const child = spawn(npmCommand(), ["start"], {
    cwd: BENCHMARK_DIR,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting for the server.
    }
  }
  throw new Error("The benchmark server did not become ready at http://127.0.0.1:8080.");
}

function ensureBenchmarkDependencies() {
  const requiredDirectories = [
    "node_modules",
    path.join("server", "node_modules"),
    path.join("webdriver-ts", "node_modules"),
    path.join("webdriver-ts-results", "node_modules"),
  ];
  const missing = requiredDirectories.filter(
    (directory) => !existsSync(path.join(BENCHMARK_DIR, directory)),
  );
  if (missing.length > 0) {
    throw new Error(
      "js-framework-benchmark dependencies are missing: " + missing.join(", ") +
        ". Install the repository dependencies before running pnpm jsfb (see the README).",
    );
  }
}

function buildComparisonFrameworks() {
  const npm = npmCommand();

  for (const framework of FRAMEWORKS.filter((name) => name !== "keyed/watervein")) {
    const frameworkDir = path.join(BENCHMARK_DIR, "frameworks", framework);
    const packageJson = path.join(frameworkDir, "package.json");
    if (!existsSync(packageJson)) {
      console.warn("Skipping " + framework + ": package.json was not found.");
      continue;
    }

    if (!existsSync(path.join(frameworkDir, "node_modules"))) {
      if (!existsSync(path.join(frameworkDir, "package-lock.json"))) {
        throw new Error("Cannot install dependencies for " + framework + ": package-lock.json is missing.");
      }
      console.log("Installing dependencies for " + framework + " (first run)...");
      run(npm, ["ci", "--ignore-scripts"], { cwd: frameworkDir });
    }

    console.log("Building " + framework + "...");
    run(npm, ["run", "build-prod"], { cwd: frameworkDir });
  }
}

async function buildWaterveinFramework(waterveinDir) {
  const npm = npmCommand();
  const packDir = mkdtempSync(path.join(os.tmpdir(), "watervein-jsfb-"));
  const frameworkDir = path.join(BENCHMARK_DIR, "frameworks", "keyed", "watervein");
  const manifestPath = path.join(frameworkDir, "package.json");
  const originalManifest = readFileSync(manifestPath, "utf8");

  try {
    const coreManifest = JSON.parse(
      readFileSync(path.join(waterveinDir, "packages", "core", "package.json"), "utf8"),
    );
    const version = coreManifest.version;
    const packedFiles = {};

    for (const packageName of WATERVEIN_PACKAGES) {
      const packageDir = path.join(waterveinDir, "packages", packageName);
      const packageManifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
      if (packageManifest.version !== version) {
        throw new Error("Expected " + packageName + " version " + version + ", found " + packageManifest.version);
      }
      run("pnpm", ["pack", "--pack-destination", packDir], { cwd: packageDir });
      const prefix = "watervein-" + packageName + "-";
      const packed = readdirSync(packDir).find((file) => file.startsWith(prefix) && file.endsWith(".tgz"));
      if (!packed) throw new Error("Could not find the packed archive for @watervein/" + packageName);
      packedFiles["@watervein/" + packageName] = path.join(packDir, packed);
    }

    const manifest = JSON.parse(originalManifest);
    manifest.version = version;
    manifest["js-framework-benchmark"].frameworkVersion = version;
    manifest.dependencies = {
      ...manifest.dependencies,
      ...Object.fromEntries(
        Object.entries(packedFiles).map(([name, archive]) => [name, "file:" + archive]),
      ),
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    console.log("Installing Watervein " + version + " from the local workspace packages...");
    run(npm, ["install", "--no-save", "--package-lock=false", "--legacy-peer-deps"], {
      cwd: frameworkDir,
    });
    run(npm, ["run", "build-prod"], { cwd: frameworkDir });
  } finally {
    writeFileSync(manifestPath, originalManifest);
    rmSync(packDir, { recursive: true, force: true });
  }
}

async function main() {
  const waterveinDir = process.cwd();
  const waterveinManifestPath = path.join(waterveinDir, "package.json");
  if (!existsSync(waterveinManifestPath)) {
    throw new Error("Run pnpm jsfb from the root of the waterveinjs/watervein repository.");
  }
  const waterveinManifest = JSON.parse(readFileSync(waterveinManifestPath, "utf8"));
  if (waterveinManifest.name !== "@watervein/monorepo") {
    throw new Error("The current directory does not look like the Watervein monorepo root.");
  }
  if (!existsSync(path.join(BENCHMARK_DIR, "webdriver-ts", "package.json"))) {
    throw new Error(
      "Could not find the benchmark checkout at " + BENCHMARK_DIR +
      ". Clone waterveinjs/js-framework-benchmark beside the Watervein checkout.",
    );
  }

  const chromeBinary = ensureChrome(waterveinDir);

  console.log("Checking js-framework-benchmark dependencies...");
  ensureBenchmarkDependencies();

  console.log("Building Watervein packages...");
  run("pnpm", ["build"], { cwd: waterveinDir });

  console.log("Compiling the benchmark runner...");
  run(npmCommand(), ["run", "compile-webdriver-ts"], { cwd: BENCHMARK_DIR });

  console.log("Building the comparison framework implementations...");
  process.chdir(BENCHMARK_DIR);
  buildComparisonFrameworks();

  console.log("Building the Watervein benchmark implementation...");
  await buildWaterveinFramework(waterveinDir);

  await ensureServer();

  console.log("Running the full keyed framework benchmark...");
  run(
    npmCommand(),
    [
      "run",
      "bench",
      "--",
      "--runner",
      "playwright",
      "--headless",
      "false",
      "--chromeBinary",
      chromeBinary,
      ...FRAMEWORKS,
      ...process.argv.slice(2),
    ],
    { cwd: BENCHMARK_DIR },
  );

  console.log("Generating the HTML comparison report...");
  const cpuModel = os.cpus()[0]?.model ?? "Unknown CPU";
  const memoryGb = (os.totalmem() / 1024 ** 3).toFixed(1);
  const reportEnvironment = {
    ...process.env,
    VITE_BENCHMARK_BROWSER: "Chrome " + CHROME_VERSION,
    VITE_BENCHMARK_ARCH: process.arch,
    VITE_BENCHMARK_HARDWARE: cpuModel + ", " + os.cpus().length + " logical CPUs, " + memoryGb + " GB RAM",
    VITE_BENCHMARK_OS: os.type() + " " + os.release(),
    VITE_BENCHMARK_RUNNER: "Playwright",
  };
  run(npmCommand(), ["run", "results"], { cwd: BENCHMARK_DIR, env: reportEnvironment });

  const reportPath = path.join(BENCHMARK_DIR, "webdriver-ts-results", "dist", "index.html");
  console.log("\nBenchmark completed. HTML report: " + reportPath);
  console.log("The benchmark server remains available at http://127.0.0.1:8080.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

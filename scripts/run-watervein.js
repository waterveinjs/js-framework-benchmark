#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const CHROME_REFERENCE_VERSION = "150.0.7871.46";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
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
      : ["google-chrome", "google-chrome-stable", "chrome"];

  for (const candidate of candidates) {
    const binary =
      path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")
        ? path.resolve(waterveinDir, candidate)
        : candidate;
    const versionOutput = spawnSync(binary, ["--version"], { encoding: "utf8" });
    if (versionOutput.error || versionOutput.status !== 0) continue;

    const versionText = (versionOutput.stdout + versionOutput.stderr).trim();
    const version = versionText.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
    if (!version) {
      throw new Error("Could not determine the installed Chrome version from: " + versionText);
    }

    console.log("Using installed browser: " + versionText);
    if (version !== CHROME_REFERENCE_VERSION) {
      console.warn(
        "Warning: benchmark reference Chrome is " + CHROME_REFERENCE_VERSION +
          ", but the installed browser is " + version +
          ". Results from different Chrome versions should not be compared directly.",
      );
    }
    return { binary, version };
  }

  throw new Error(
    "Google Chrome was not found. Install Chrome and add it to PATH, or set CHROME_BINARY to its executable path.",
  );
}

function getChromeDriverInstallEnvironment(chromeVersion) {
  const env = {
    ...process.env,
    // The runner explicitly launches the installed Google Chrome executable.
    // Do not download Playwright-managed Chromium/Firefox/WebKit browser builds.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  };

  const driverBinary = process.env.CHROMEDRIVER_BINARY ||
    (process.platform === "win32" ? "chromedriver.exe" : "chromedriver");
  const driverResult = spawnSync(driverBinary, ["--version"], { encoding: "utf8" });
  const driverText = !driverResult.error && driverResult.status === 0
    ? (driverResult.stdout + driverResult.stderr).trim()
    : "";
  const driverMajor = driverText.match(/ChromeDriver\s+(\d+)/i)?.[1];
  const chromeMajor = chromeVersion.split(".")[0];

  if (driverMajor === chromeMajor) {
    env.CHROMEDRIVER_SKIP_DOWNLOAD = "true";
    console.log("Reusing compatible system ChromeDriver: " + driverText);
  } else {
    env.CHROMEDRIVER_SKIP_DOWNLOAD = "false";
    if (driverText) {
      console.log("System ChromeDriver is not compatible with Chrome " + chromeVersion + "; installing the benchmark-pinned driver.");
    } else {
      console.log("No system ChromeDriver found; the benchmark dependency setup will install its required driver.");
    }
  }

  return { env, driverText };
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
    shell: process.platform === "win32",
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

function installNpmDependencies(directory, label, env = process.env) {
  const manifestPath = path.join(directory, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Cannot set up " + label + ": package.json was not found at " + directory);
  }

  const lockPath = path.join(directory, "package-lock.json");
  const markerPath = path.join(directory, "node_modules", ".jsfb-install-state.json");
  const fingerprint = createHash("sha256")
    .update(readFileSync(manifestPath))
    .update(existsSync(lockPath) ? readFileSync(lockPath) : "no-lockfile")
    .update("run-scripts")
    .digest("hex");

  if (existsSync(markerPath) && readFileSync(markerPath, "utf8") === fingerprint) {
    console.log(label + " dependencies are already up to date; skipping install.");
    return;
  }

  const args = existsSync(lockPath)
    ? ["ci", "--no-audit", "--no-fund"]
    : ["install", "--no-audit", "--no-fund"];

  console.log("Installing " + label + " dependencies (normal lifecycle scripts enabled)...");
  run(npmCommand(), args, { cwd: directory, env });
  writeFileSync(markerPath, fingerprint);
}

function ensureWaterveinDependencies(waterveinDir) {
  const lockPath = path.join(waterveinDir, "pnpm-lock.yaml");
  if (!existsSync(lockPath)) {
    throw new Error("pnpm-lock.yaml was not found in the Watervein repository root.");
  }

  const markerPath = path.join(waterveinDir, "node_modules", ".jsfb-pnpm-install-state.json");
  const fingerprint = createHash("sha256")
    .update(readFileSync(path.join(waterveinDir, "package.json")))
    .update(readFileSync(lockPath))
    .digest("hex");

  if (existsSync(markerPath) && readFileSync(markerPath, "utf8") === fingerprint) {
    console.log("Watervein workspace dependencies are already up to date; skipping install.");
    return;
  }

  console.log("Installing Watervein workspace dependencies...");
  run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: waterveinDir });
  writeFileSync(markerPath, fingerprint);
}

function ensureBenchmarkDependencies(chromeVersion) {
  const { env, driverText } = getChromeDriverInstallEnvironment(chromeVersion);
  const dependencyDirectories = [
    BENCHMARK_DIR,
    path.join(BENCHMARK_DIR, "webdriver-ts"),
    path.join(BENCHMARK_DIR, "webdriver-ts-results"),
    path.join(BENCHMARK_DIR, "server"),
  ];
  const fingerprintHash = createHash("sha256");
  for (const directory of dependencyDirectories) {
    fingerprintHash
      .update(readFileSync(path.join(directory, "package.json")))
      .update(existsSync(path.join(directory, "package-lock.json"))
        ? readFileSync(path.join(directory, "package-lock.json"))
        : "no-lockfile");
  }
  const fingerprint = fingerprintHash
    .update(env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)
    .update(env.CHROMEDRIVER_SKIP_DOWNLOAD)
    .update(driverText)
    .digest("hex");
  const markerPath = path.join(BENCHMARK_DIR, "node_modules", ".jsfb-dependency-setup-state");
  if (existsSync(markerPath) && readFileSync(markerPath, "utf8") === fingerprint) {
    console.log("Benchmark dependencies are already up to date; skipping npm setup.");
    return false;
  }

  // Follow the benchmark repository's normal setup. This runs root postinstall,
  // then installs/compiles WebDriver, installs report dependencies, and installs
  // server dependencies. Only redundant browser/driver binary downloads are
  // skipped; package lifecycle scripts remain enabled.
  console.log("Installing benchmark dependencies with the standard npm setup...");
  run(npmCommand(), ["ci", "--no-audit", "--no-fund"], { cwd: BENCHMARK_DIR, env });
  run(npmCommand(), ["run", "install-local"], { cwd: BENCHMARK_DIR, env });
  writeFileSync(markerPath, fingerprint);
  return true;
}

function buildComparisonFrameworks() {
  for (const framework of FRAMEWORKS.filter((name) => name !== "keyed/watervein")) {
    const frameworkDir = path.join(BENCHMARK_DIR, "frameworks", framework);
    const packageJsonPath = path.join(frameworkDir, "package.json");
    if (!existsSync(packageJsonPath)) {
      throw new Error("Required comparison framework is missing: " + framework);
    }

    installNpmDependencies(frameworkDir, framework);

    console.log("Building " + framework + "...");
    run(npmCommand(), ["run", "build-prod"], { cwd: frameworkDir });
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

  const chrome = ensureChrome(waterveinDir);

  console.log("Setting up Watervein and benchmark dependencies...");
  ensureWaterveinDependencies(waterveinDir);
  const benchmarkDependenciesInstalled = ensureBenchmarkDependencies(chrome.version);

  console.log("Building Watervein packages...");
  run("pnpm", ["build"], { cwd: waterveinDir });

  if (!benchmarkDependenciesInstalled) {
    console.log("Compiling the benchmark runner...");
    run(npmCommand(), ["run", "compile-webdriver-ts"], { cwd: BENCHMARK_DIR });
  }

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
      chrome.binary,
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
    VITE_BENCHMARK_BROWSER: "Chrome " + chrome.version,
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

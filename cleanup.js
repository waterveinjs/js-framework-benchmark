// @ts-check
import * as fs from "node:fs";
import path from "node:path";

/**
 * Removes all subdirectories in frameworks/keyed and frameworks/non-keyed
 * that do not contain a package.json file.
 */
function cleanupFrameworksWithoutPackageJson() {
  const frameworksDirPath = path.resolve("frameworks");
  const frameworkTypes = ["keyed", "non-keyed"];

  let deletedCount = 0;

  for (const type of frameworkTypes) {
    const typeDir = path.join(frameworksDirPath, type);

    if (!fs.existsSync(typeDir)) {
      console.warn(`Directory not found: ${typeDir}`);
      continue;
    }

    const entries = fs.readdirSync(typeDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const frameworkPath = path.join(typeDir, entry.name);
      const pkgPath = path.join(frameworkPath, "package.json");

      if (!fs.existsSync(pkgPath)) {
        console.log(`Removing framework without package.json: ${type}/${entry.name}`);
        fs.rmSync(frameworkPath, { recursive: true, force: true });
        deletedCount++;
      }
    }
  }

  console.log(`\nCleanup complete. Deleted ${deletedCount} directories.`);
}

cleanupFrameworksWithoutPackageJson();

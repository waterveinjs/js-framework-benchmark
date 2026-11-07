import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Resolve an executable name or path to its absolute, real filesystem path.
 * Returns null when the candidate cannot be found or is not executable.
 */
export function resolveExecutable(candidate, { cwd = process.cwd(), env = process.env } = {}) {
  if (typeof candidate !== "string" || candidate.length === 0) return null;

  const isPath = path.isAbsolute(candidate) || candidate.includes(path.sep) || candidate.includes("/");
  const extensions = process.platform === "win32" && !path.extname(candidate)
    ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const locations = isPath
    ? extensions.map((extension) => path.resolve(cwd, candidate + extension))
    : (env.PATH || "").split(path.delimiter).filter(Boolean).flatMap((directory) =>
        extensions.map((extension) => path.join(directory, candidate + extension)),
      );

  for (const location of locations) {
    try {
      const realPath = realpathSync.native(location);
      if (!statSync(realPath).isFile()) continue;
      if (process.platform !== "win32") accessSync(realPath, constants.X_OK);
      return realPath;
    } catch {
      // Keep looking through PATH entries when a candidate is missing or unusable.
    }
  }

  return null;
}

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveExecutable } from "./resolve-executable.js";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jsfb-chrome-path-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  const executableName = process.platform === "win32" ? "test-chrome.exe" : "test-chrome";
  const executable = path.join(bin, executableName);
  const command = process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n";
  writeFileSync(executable, command);
  if (process.platform !== "win32") chmodSync(executable, 0o755);
  return { directory, bin, executable, executableName, env: { PATH: bin } };
}

test("resolves a command found on PATH to an absolute real path", (t) => {
  const { directory, executableName, executable, env } = fixture(t);
  const resolved = resolveExecutable(executableName, { cwd: directory, env });
  assert.equal(resolved, realpathSync.native(executable));
  assert.equal(path.isAbsolute(resolved), true);
});

test("resolves symlinks to the actual executable", { skip: process.platform === "win32" }, (t) => {
  const { directory, executable, env, bin } = fixture(t);
  const alias = path.join(bin, "chrome-alias");
  symlinkSync(executable, alias);
  const resolved = resolveExecutable("chrome-alias", { cwd: directory, env });
  assert.equal(resolved, realpathSync.native(executable));
});

test("resolves an explicit relative executable path", (t) => {
  const { directory, executable, bin } = fixture(t);
  const resolved = resolveExecutable(path.relative(directory, executable), {
    cwd: directory,
    env: { PATH: "" },
  });
  assert.equal(resolved, realpathSync.native(executable));
  assert.equal(path.dirname(resolved), realpathSync.native(bin));
});

test("returns null when an executable cannot be found", (t) => {
  const { directory } = fixture(t);
  assert.equal(resolveExecutable("missing-chrome", { cwd: directory, env: { PATH: "" } }), null);
});

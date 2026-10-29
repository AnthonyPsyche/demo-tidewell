#!/usr/bin/env node
// Publishes dist/ to the `gh-pages` branch of `origin` (for GitHub Pages) after build + check pass.
// Only use when the project calls for a public preview (SKILL.md stage 5). The branch is generated output and is force-pushed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

run("node", ["tools/build.mjs"]);
run("node", ["tools/check.mjs"]);
const site = JSON.parse(fs.readFileSync(path.join(root, "site.json"), "utf8"));
if (!site.noindex) { console.error('Refusing to deploy: site.json "noindex" is not true.'); process.exit(1); }

const remote = run("git", ["remote", "get-url", "origin"]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
fs.cpSync(path.join(root, "dist"), tmp, { recursive: true });
run("git", ["init", "-q", "-b", "gh-pages"], tmp);
run("git", ["add", "-A"], tmp);
run("git", ["-c", "user.name=deploy", "-c", "user.email=deploy@localhost", "commit", "-q", "-m", "Deploy preview"], tmp);
run("git", ["push", "-q", "--force", remote, "gh-pages"], tmp);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("deployed dist/ to gh-pages");

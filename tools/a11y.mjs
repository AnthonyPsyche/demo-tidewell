#!/usr/bin/env node
// WCAG audit: runs axe-core (WCAG 2.0/2.1/2.2 A and AA + best-practice rules) in headless Chrome against every built page
// at desktop (1440) and mobile (390), plus mobile with the nav menu open. Exits 1 on any violation.
// Set VERBOSE=1 to list the exact elements axe could not decide. Automated rules catch only part of WCAG; "needs review" items are listed and the manual checklist in SKILL.md still applies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.join(root, "dist");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) { console.error("Chrome not found; set CHROME=/path/to/chrome"); process.exit(1); }
if (!fs.existsSync(dist)) { console.error("Run `npm run build` first"); process.exit(1); }
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

// The Branding page is a type specimen (H1-H5 in a row), so heading-order rules do not apply to it.
const HEADING_EXEMPT = new Set(["branding/index.html"]);
const HEADING_RULES = ["heading-order", "page-has-heading-one", "empty-heading"];

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const pages = walk(dist).filter((f) => f.endsWith(".html")).map((f) => path.relative(dist, f).split(path.sep).join("/")).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9800 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
let targets;
for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); } }
if (!targets) { chrome.kill(); throw new Error("Chrome did not start"); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map(); const listeners = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else listeners.forEach((l) => l(d)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
const loaded = () => new Promise((res) => { const l = (d) => { if (d.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(l), 1); res(); } }; listeners.push(l); });
await send("Page.enable");

async function audit(rel, state) {
  const ids = await evaluate(`(async () => {
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa","best-practice"] } });
    const pick = (list) => list.map((v) => ({ id: v.id, impact: v.impact, help: v.help, url: v.helpUrl, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ") + (n.any[0] ? " :: " + n.any[0].message : "")), count: v.nodes.length }));
    return JSON.stringify({ violations: pick(r.violations), incomplete: pick(r.incomplete) });
  })()`);
  const data = JSON.parse(ids.result.value);
  if (HEADING_EXEMPT.has(rel)) data.violations = data.violations.filter((v) => !HEADING_RULES.includes(v.id));
  return data;
}

let failures = 0; const review = new Map();
for (const rel of pages) {
  for (const [name, width, mobile, openMenu] of [["desktop", 1440, false, false], ["mobile", 390, true, false], ["mobile, menu open", 390, true, true]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
    const l = loaded();
    await send("Page.navigate", { url: "file://" + path.join(dist, rel) });
    await l; await sleep(300);
    // settle motion: show reveal content, eager-load images, freeze animations/transitions so contrast is measured on the final state
    await evaluate(`(async () => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}"; document.head.append(s); document.querySelectorAll(".reveal,.draw").forEach(e=>e.classList.add("in")); document.querySelectorAll("[data-count]").forEach(e=>e.textContent=e.dataset.count); document.querySelectorAll("img[loading=lazy]").forEach(i=>i.loading="eager"); await Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))); })()`);
    if (openMenu) {
      const has = (await evaluate(`!!document.querySelector(".nav-toggle") && getComputedStyle(document.querySelector(".nav-toggle")).display !== "none"`)).result.value;
      if (!has) continue;
      await evaluate(`document.querySelector(".nav-toggle").click()`);
      await sleep(100);
    }
    await evaluate(axeSource);
    const { violations, incomplete } = await audit(rel, name);
    for (const v of violations) {
      failures++;
      console.error(`FAIL ${rel} [${name}] ${v.id} (${v.impact}) x${v.count}: ${v.help}\n     ${v.nodes.join("\n     ")}\n     ${v.url}`);
    }
    for (const v of incomplete) { review.set(v.id, (review.get(v.id) || new Set()).add(rel)); if (process.env.VERBOSE) console.log(`review ${rel} [${name}] ${v.id} x${v.count}:\n     ${v.nodes.join("\n     ")}`); }
  }
}
ws.close(); chrome.kill(); await sleep(800);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}

if (review.size) console.log("needs manual review (axe could not decide):\n" + [...review].map(([k, v]) => `  ${k}: ${[...v].join(", ")}`).join("\n"));
if (failures) { console.error(`\n${failures} WCAG violation(s)`); process.exit(1); }
console.log(`a11y passed: ${pages.length} pages, 0 axe violations (WCAG 2.2 AA + best practice)`);

#!/usr/bin/env node
// Full-page screenshots of every page in dist/ at desktop (1440) and mobile (390), written to review/ with a review/README.md
// that embeds them, so drafts can be reviewed on GitHub (which shows HTML as source, not as a page). Needs Google Chrome; no npm deps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.join(root, "dist");
const out = path.join(root, "review");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) { console.error("Chrome not found; set CHROME=/path/to/chrome"); process.exit(1); }
if (!fs.existsSync(dist)) { console.error("Run `npm run build` first"); process.exit(1); }

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const pages = walk(dist).filter((f) => f.endsWith(".html") && !f.endsWith("404.html")).map((f) => path.relative(dist, f)).sort();
const slug = (p) => (p === "index.html" ? "home" : p.replace(/\/index\.html$/, "").replace(/[\/]/g, "-"));
const VIEWPORTS = [["desktop", 1440, false], ["mobile", 390, true]];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
}
if (!targets) { chrome.kill(); throw new Error("Chrome did not start"); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map(); const listeners = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else listeners.forEach((l) => l(d)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const loaded = () => new Promise((res) => { const l = (d) => { if (d.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(l), 1); res(); } }; listeners.push(l); });

await send("Page.enable");
let md = "# Layout draft review\n\nFull-page screenshots of every page (desktop 1440px and mobile 390px). Regenerate with `npm run build && npm run shots`.\n";
for (const p of pages) {
  md += `\n## ${p === "index.html" ? "/" : "/" + p.replace(/index\.html$/, "")}\n\n`;
  for (const [name, width, mobile] of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
    const l = loaded();
    await send("Page.navigate", { url: "file://" + path.join(dist, p) });
    await l; await sleep(400);
    // reveal-on-scroll content never intersects in a full-page capture, so show it, and pin looping animations
    await send("Runtime.evaluate", { expression: `document.querySelectorAll(".reveal,.draw").forEach(e=>e.classList.add("in")); document.querySelectorAll("[data-count]").forEach(e=>e.textContent=e.dataset.count); document.querySelectorAll("img[loading=lazy]").forEach(i=>i.loading="eager"); Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))`, awaitPromise: true });
    await sleep(1500);
    const m = await send("Page.getLayoutMetrics");
    const height = Math.ceil(m.result.cssContentSize.height);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    const file = `${slug(p)}-${name}.png`;
    fs.writeFileSync(path.join(out, file), Buffer.from(shot.result.data, "base64"));
    md += `**${name}**\n\n![${slug(p)} ${name}](${file})\n\n`;
    console.log("shot", file, `${width}x${height}`);
  }
}
fs.writeFileSync(path.join(out, "README.md"), md);
ws.close(); chrome.kill(); await sleep(800);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} // temp profile; harmless if Chrome still holds a file

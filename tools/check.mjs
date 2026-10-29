#!/usr/bin/env node
// Verifies dist/: every link/asset resolves, no unquoted/malformed attributes, no third-party scripts/trackers, alt text present.
// Exits 1 on any problem so it can gate a push.
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "dist");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const TRACKERS = /googletagmanager|google-analytics|gtag\(|fbq\(|connect\.facebook|hotjar|clarity\.ms|hs-scripts|doubleclick|segment\.com|mixpanel|plausible|datafa\.st|recaptcha|cookieyes/i;
const problems = [];
const add = (file, msg) => problems.push(`${path.relative(dist, file)}: ${msg}`);

for (const file of walk(dist).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);

  for (const m of html.matchAll(/<[a-z][^>]*?\s(href|src)=([^\s>]*)/gi)) {
    if (!/^["']/.test(m[2])) add(file, `unquoted ${m[1]}=${m[2]}`);
  }
  for (const m of html.matchAll(/\b(?:href|src|poster)="([^"]*)"/g)) {
    const u = m[1];
    if (!u || /^(https?:|\/\/|mailto:|tel:|data:|javascript:|#)/.test(u)) continue;
    if (u.startsWith("/")) { add(file, `root-absolute path ${u} (breaks off-root hosting)`); continue; }
    const target = path.normalize(path.join(dir, decodeURIComponent(u.split(/[?#]/)[0])));
    if (!fs.existsSync(target)) add(file, `broken link ${u}`);
  }
  for (const m of html.matchAll(/<script[^>]*\ssrc="(https?:)?\/\/[^"]+"/gi)) add(file, `third-party script ${m[0].slice(0, 90)}`);
  for (const m of html.matchAll(/<link[^>]*rel="(?:preconnect|dns-prefetch)"[^>]*>/gi)) add(file, `third-party connection hint ${m[0]}`);
  if (TRACKERS.test(html)) add(file, "tracker/analytics string found");
  for (const m of html.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)) add(file, `img missing alt ${m[0].slice(0, 80)}`);
  if (!/<title>[^<]+<\/title>/.test(html)) add(file, "missing <title>");
  if (!/<meta name="viewport"/.test(html)) add(file, "missing viewport meta");
  for (const m of html.matchAll(/<iframe[^>]*src="(https?:\/\/[^"]+)"/gi)) console.warn(`note: ${path.relative(dist, file)} embeds ${m[1]} (third-party contact on view)`);
}
for (const file of walk(dist).filter((f) => f.endsWith(".css"))) {
  for (const m of fs.readFileSync(file, "utf8").matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const u = m[2];
    if (/^(https?:|\/\/|data:)/.test(u)) { add(file, `external css url ${u}`); continue; }
    if (u.startsWith("/")) { add(file, `root-absolute css url ${u}`); continue; }
    if (!fs.existsSync(path.join(path.dirname(file), u.split(/[?#]/)[0]))) add(file, `missing css asset ${u}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`check passed: ${walk(dist).filter((f) => f.endsWith(".html")).length} pages, no problems`);

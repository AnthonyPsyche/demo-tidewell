#!/usr/bin/env node
// Zero-dependency static build: src/pages/** + src/partials + src/layout.html -> dist/
// - {{> partial}} includes, {{title}} / {{description}} from page front matter
// - author links as root paths (/about/, /css/site.css); output is page-relative, so dist/ works from any folder or file://
// - site.json "noindex": true adds a robots meta to every page and writes a disallow-all robots.txt
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");
const site = JSON.parse(fs.readFileSync(path.join(root, "site.json"), "utf8"));

const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, text];
  const data = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return [data, text.slice(m[0].length)];
}

const partials = {};
for (const f of walk(path.join(src, "partials"))) partials[path.basename(f, ".html")] = read(f);
const layout = read(path.join(src, "layout.html"));

const include = (html, depth = 0) => {
  if (depth > 5) throw new Error("partial include loop");
  return html.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
    if (!(name in partials)) throw new Error(`Missing partial: ${name}`);
    return include(partials[name], depth + 1);
  });
};

// "/about/#team" -> "../about/index.html#team" relative to the page being written
function relink(html, outFile) {
  const dir = path.posix.dirname(outFile);
  const fix = (url) => {
    const m = url.match(/^(\/[^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!m || url.startsWith("//")) return url;
    let p = m[1];
    if (p.endsWith("/")) p += "index.html";
    return path.posix.relative(dir, p.slice(1)) + (m[2] || "") + (m[3] || "");
  };
  return html
    .replace(/\b(href|src|poster|data-src)="([^"]*)"/g, (_, a, u) => `${a}="${fix(u)}"`)
    .replace(/\bsrcset="([^"]*)"/g, (_, s) =>
      `srcset="${s.split(",").map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return [fix(u), ...rest].join(" ");
      }).join(", ")}"`)
    .replace(/url\((['"]?)(\/[^'")]+)\1\)/g, (_, q, u) => `url(${q}${fix(u)}${q})`);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// public/ is copied verbatim (CSS gets root-path url() rewrites relative to its own location)
const pub = path.join(src, "public");
if (fs.existsSync(pub)) {
  for (const f of walk(pub)) {
    const rel = path.relative(pub, f).split(path.sep).join("/");
    const out = path.join(dist, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (f.endsWith(".css")) fs.writeFileSync(out, relink(read(f), rel));
    else fs.copyFileSync(f, out);
  }
}

let count = 0;
for (const f of walk(path.join(src, "pages")).filter((f) => f.endsWith(".html"))) {
  const rel = path.relative(path.join(src, "pages"), f).split(path.sep).join("/");
  const outRel = rel === "index.html" || rel.endsWith("/index.html") || rel === "404.html" ? rel : rel.replace(/\.html$/, "/index.html");
  const [data, body] = frontMatter(read(f));
  const robots = site.noindex ? '<meta name="robots" content="noindex, nofollow">' : "";
  let html = include(layout)
    .replace("{{content}}", () => include(body))
    .replace("{{robots}}", robots)
    .replace(/\{\{title\}\}/g, data.title || site.name)
    .replace(/\{\{description\}\}/g, data.description || "")
    .replace(/\{\{site\.name\}\}/g, site.name)
    .replace(/\{\{locale\}\}/g, site.locale || "en");
  html = relink(html, outRel);
  const out = path.join(dist, outRel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  count++;
}

fs.writeFileSync(path.join(dist, ".nojekyll"), "");
if (site.noindex) fs.writeFileSync(path.join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
console.log(`built ${count} pages -> dist/${site.noindex ? " (noindex)" : ""}`);

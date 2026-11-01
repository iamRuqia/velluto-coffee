// Quality gate for the Velluto site. Runs in CI and with `npm run check`.
// No dependencies: it only uses Node's built-in modules.
//
// It checks that:
//   1. every JavaScript file and inline <script> compiles,
//   2. the product data embedded in the page is valid JSON,
//   3. every local file the page points to (scripts, styles, images) exists,
//   4. the page has a language, viewport, title and description.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = "index.html";
const html = readFileSync(resolve(root, page), "utf8");
const problems = [];
const isLocal = (url) => !/^(https?:|data:|mailto:|tel:|#|%23|\/\/)/.test(url);

// 1. Inline scripts and local script files must compile.
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
inline.forEach((code, i) => {
  try { new vm.Script(code, { filename: `${page} <script #${i + 1}>` }); }
  catch (err) { problems.push(`${page}: inline script #${i + 1} does not compile: ${err.message}`); }
});
const scriptFiles = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]).filter(isLocal);
for (const file of scriptFiles) {
  const path = resolve(root, file);
  if (!existsSync(path)) { problems.push(`missing script: ${file}`); continue; }
  try { new vm.Script(readFileSync(path, "utf8"), { filename: file }); }
  catch (err) { problems.push(`${file} does not compile: ${err.message}`); }
}

// 2. Embedded JSON (structured data and the product list) must parse.
for (const [, type, body] of html.matchAll(/<script type="(application\/(?:ld\+)?json)"[^>]*>([\s\S]*?)<\/script>/g)) {
  try { JSON.parse(body); }
  catch (err) { problems.push(`${page}: ${type} block is not valid JSON: ${err.message}`); }
}

// 3. Every local file reference must exist.
const refs = new Set();
for (const [, attr, value] of html.matchAll(/\s(src|href|srcset|data-src|data-srcset)="([^"]+)"/g)) {
  const urls = attr.includes("srcset") ? value.split(",").map((part) => part.trim().split(/\s+/)[0]) : [value];
  urls.filter((url) => url && isLocal(url)).forEach((url) => refs.add(url.split(/[?#]/)[0]));
}
for (const css of [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]).filter(isLocal)) {
  const text = readFileSync(resolve(root, css), "utf8");
  for (const [, url] of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (isLocal(url)) refs.add(resolve(dirname(resolve(root, css)), url).slice(root.length + 1));
  }
}
for (const ref of refs) {
  if (!existsSync(resolve(root, ref))) problems.push(`broken reference: ${ref}`);
}

// 4. The basics every page needs.
const required = {
  'lang attribute on <html>': /<html[^>]*\slang="[a-z-]+"/i,
  "viewport meta tag": /<meta[^>]+name="viewport"/i,
  "<title>": /<title>[^<]+<\/title>/i,
  "meta description": /<meta[^>]+name="description"/i,
};
for (const [label, pattern] of Object.entries(required)) {
  if (!pattern.test(html)) problems.push(`${page}: missing ${label}`);
}

console.log(`✓ ${inline.length} inline script(s), ${scriptFiles.length} script file(s), ${refs.size} local file reference(s) checked`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("All checks passed.");

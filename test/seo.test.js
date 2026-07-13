import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(repositoryRoot, "index.html"), "utf8");
const canonicalUrl = "https://yazelin.github.io/mandarin-taigi/";
const ogImageUrl = `${canonicalUrl}assets/og-image.png`;

test("homepage exposes complete canonical and social sharing metadata", () => {
  assert.match(html, new RegExp(`<link rel="canonical" href="${canonicalUrl}"`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${canonicalUrl}"`));
  assert.ok(html.includes(`content="${ogImageUrl}"`));
  assert.match(html, /<meta property="og:image:width" content="1200"/);
  assert.match(html, /<meta property="og:image:height" content="630"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
});

test("Open Graph PNG has the declared 1200 by 630 dimensions", () => {
  const png = readFileSync(resolve(repositoryRoot, "assets/og-image.png"));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("structured data and sitemap use the public Pages URL", () => {
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLdMatch);
  const structuredData = JSON.parse(jsonLdMatch[1]);
  assert.equal(structuredData.url, canonicalUrl);
  assert.equal(structuredData["@type"], "WebApplication");

  const sitemap = readFileSync(resolve(repositoryRoot, "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes(`<loc>${canonicalUrl}</loc>`));
});

test("install icons include regular, maskable, and Apple PNG sizes", () => {
  const expected = [
    ["assets/icon-192.png", 192, 192],
    ["assets/icon-512.png", 512, 512],
    ["assets/icon-maskable-512.png", 512, 512],
    ["assets/apple-touch-icon.png", 180, 180],
  ];
  for (const [path, width, height] of expected) {
    const png = readFileSync(resolve(repositoryRoot, path));
    assert.equal(png.readUInt32BE(16), width, path);
    assert.equal(png.readUInt32BE(20), height, path);
  }

  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "manifest.webmanifest"), "utf8"));
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  assert.ok(html.includes('<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png"'));
});

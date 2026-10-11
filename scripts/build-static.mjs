import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync
} from "node:fs";

import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const files = [
  "index.html",
  "console.html",
  "docs.html",
  "login.html",
  "web-setup.html",
  "styles.css",
  "console.css",
  "docs.css",
  "app.js",
  "console.js",
  "docs.js",
  "login.js",
  "favicon.svg",
  "assets"
];

for (const file of files) {
  const source = join(root, file);

  if (existsSync(source)) {
    cpSync(source, join(dist, file), {
      recursive: true
    });
    console.log("Copied:", file);
  }
}

console.log("WROSECODE static website build completed.");

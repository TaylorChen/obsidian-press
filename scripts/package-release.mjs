import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const releaseDir = path.join(root, "dist", `${manifest.id}-${manifest.version}`);
const assets = ["main.js", "manifest.json", "styles.css"];

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

for (const asset of assets) {
  const source = path.join(root, asset);
  const target = path.join(releaseDir, asset);
  await copyFile(source, target);

  const assetStat = await stat(target);
  if (assetStat.size <= 0) {
    throw new Error(`Release asset is empty: ${asset}`);
  }
}

const entry = {
  id: manifest.id,
  name: manifest.name,
  author: manifest.author,
  description: manifest.description,
  repo: "TaylorChen/obsidian-press",
};

await writeFile(
  path.join(releaseDir, "community-plugins-entry.json"),
  `${JSON.stringify(entry, null, 2)}\n`,
  "utf8"
);

console.log(`Release assets prepared in ${releaseDir}`);
console.log("Attach these files to the GitHub release:");
for (const asset of assets) {
  console.log(`- ${path.join(releaseDir, asset)}`);
}

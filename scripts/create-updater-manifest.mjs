import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  })
);

const assetsDir = args.assetsDir || "release-assets";
const repo = args.repo || "finalsoul1/localbiz-scout-desktop";
const tag = args.tag || "latest";
const version = (args.version || "").replace(/^v/, "");
const notes = args.notes || "상권스카우트 업데이트";

if (!version) {
  throw new Error("--version is required");
}

const files = await listFiles(assetsDir);
const macBundle = findFile(files, (file) => file.endsWith(".app.tar.gz"));
const macSignature = macBundle ? `${macBundle}.sig` : "";
const windowsBundle = findFile(files, (file) => file.endsWith(".exe"));
const windowsSignature = windowsBundle ? `${windowsBundle}.sig` : "";

const platforms = {};

if (macBundle && files.includes(macSignature)) {
  platforms["darwin-aarch64"] = {
    signature: await readSignature(macSignature),
    url: releaseAssetUrl(repo, tag, path.basename(macBundle))
  };
}

if (windowsBundle && files.includes(windowsSignature)) {
  platforms["windows-x86_64"] = {
    signature: await readSignature(windowsSignature),
    url: releaseAssetUrl(repo, tag, path.basename(windowsBundle))
  };
}

if (!Object.keys(platforms).length) {
  throw new Error("No updater artifacts were found");
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms
};

await writeFile(path.join(assetsDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(fullPath)));
    } else {
      result.push(fullPath);
    }
  }

  return result;
}

function findFile(files, predicate) {
  return files.find((file) => predicate(path.basename(file))) || "";
}

async function readSignature(file) {
  return (await readFile(file, "utf8")).trim();
}

function releaseAssetUrl(repo, tag, filename) {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(filename)}`;
}

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { product } = require("./products.cjs");

const CONTROL_FILES = Object.freeze([
  ".gitattributes", ".github/workflows/publish.yml", "scripts/release.cjs", "scripts/bridge.cjs",
  "release.json", "SHA256SUMS", "bridge-files.json", "scripts/products.cjs", "scripts/npm-query.cjs", "scripts/candidate-smoke-evidence.cjs",
  "evidence/candidate.json", "evidence/gate.json", "evidence/darwin.json", "evidence/linux.json", "evidence/win32.json"
]);
const BRIDGE_ROOT_FILES = Object.freeze([
  "README.md", "package.json", "index.mjs", "cordis.patch.yml", ".gitignore",
  "LICENSE", "THIRD_PARTY_NOTICES.txt", "npm/dsh.mjs"
]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function rootFiles(variant) { return product(variant).dsh ? BRIDGE_ROOT_FILES : ["README.md", "package.json", ".gitignore", "LICENSE", "THIRD_PARTY_NOTICES.txt"]; }
function isBridgePath(name, variant = "fnos") {
  const id = product(variant);
  const runtimePaths = ["runtime-manifest.json", "runtime-setup.md", ...["", ".cmd", ".ps1"].map(suffix => `scripts/${id.commandName}${suffix}`)].map(file => `skills/${id.commandName}/${file}`);
  return typeof name === "string" && (rootFiles(variant).includes(name) || runtimePaths.includes(name)
    || new RegExp(`^skills/${id.commandName}/(SKILL\\.md|LICENSE|THIRD_PARTY_NOTICES\\.txt|(?:entries|reference)/[a-z0-9_-]+(?:/[a-z0-9_-]+)*\\.md)$`).test(name));
}

function regularFile(root, name) {
  let current = root;
  for (const part of name.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink in public bridge: ${name}`);
  }
  if (!fs.lstatSync(current).isFile()) throw new Error(`Not a public bridge file: ${name}`);
  return current;
}

function writeBridgeManifest(root, files, version) {
  const manifest = { schemaVersion: 1, version, files: [...files].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bytes]) => ({ path: name, sha256: digest(bytes) })) };
  fs.writeFileSync(path.join(root, "bridge-files.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return digest(fs.readFileSync(path.join(root, "bridge-files.json")));
}

function readBridgeManifest(root, release) {
  const variant = release.variant || "fnos";
  const id = product(variant);
  const required = [...rootFiles(variant), ...["SKILL.md", "LICENSE", "runtime-manifest.json", "runtime-setup.md", `scripts/${id.commandName}`, `scripts/${id.commandName}.cmd`, `scripts/${id.commandName}.ps1`].map(name => `skills/${id.commandName}/${name}`)];
  const file = regularFile(root, "bridge-files.json");
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== release.bridgeManifestSha256) throw new Error("Public bridge manifest checksum mismatch");
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 1 || manifest.version !== release.version || !Array.isArray(manifest.files)
    || manifest.files.length < required.length
    || manifest.files.some((item) => !item || !isBridgePath(item.path, variant) || !/^[a-f0-9]{64}$/.test(item.sha256))
    || new Set(manifest.files.map((item) => item.path)).size !== manifest.files.length
    || required.some((name) => !manifest.files.some((item) => item.path === name))) {
    throw new Error("Invalid public bridge file allowlist");
  }
  return manifest;
}

function readBridge(root, release) {
  const id = product(release.variant || "fnos");
  const manifest = readBridgeManifest(root, release);
  for (const item of manifest.files) {
    if (digest(fs.readFileSync(regularFile(root, item.path))) !== item.sha256) {
      throw new Error(`Public bridge checksum mismatch: ${item.path}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.name !== id.bridgeName || pkg.version !== release.version || pkg.private !== true
    || pkg.license !== "MIT" || pkg.repository?.url !== `https://github.com/${id.repository}.git` || pkg.scripts
    || (id.dsh ? (pkg.main !== "index.mjs" || pkg.type !== "module"
      || JSON.stringify(pkg.dependencies) !== JSON.stringify({ [id.packageName]: "latest" })
      || pkg.dsh?.bundle?.patch !== "./cordis.patch.yml") : (pkg.main || pkg.dependencies || pkg.dsh))) {
    throw new Error("Invalid public bridge package identity or dependency policy");
  }
  return manifest.files.map((item) => item.path);
}

// Only generated public paths are replaced. Release control files and unrelated
// repository content belong to other steps; never recursively clear a checkout.
function copyBridge(source, destination, names, tracked = [], variant = "fnos") {
  for (const name of tracked.filter((name) => isBridgePath(name, variant) && !names.includes(name))) {
    fs.unlinkSync(regularFile(destination, name));
  }
  for (const name of names) {
    if (!isBridgePath(name, variant)) throw new Error(`Invalid public bridge path: ${name}`);
    const target = path.join(destination, name);
    let parent = destination;
    for (const part of name.split("/").slice(0, -1)) {
      parent = path.join(parent, part);
      if (fs.existsSync(parent) && (!fs.lstatSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink())) {
        throw new Error(`Unsafe public bridge destination: ${name}`);
      }
      fs.mkdirSync(parent, { recursive: true });
    }
    try {
      fs.lstatSync(target);
      regularFile(destination, name);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    fs.copyFileSync(regularFile(source, name), target);
    if (/^skills\/[^/]+\/scripts\/[^/.]+$/.test(name)) fs.chmodSync(target, 0o755);
  }
}

module.exports = { CONTROL_FILES, isBridgePath, regularFile, writeBridgeManifest, readBridgeManifest, readBridge, copyBridge };

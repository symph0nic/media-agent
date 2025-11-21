import fs from "fs";
import path from "path";
import { Client as SSHClient } from "ssh2";
import { execFile } from "child_process";

const posixPath = path.posix || path;

function hasSsh(config) {
  return Boolean(config?.NAS_SSH_HOST && config?.NAS_SSH_USERNAME);
}

function ensureSshCredentials(config) {
  const sshConfig = {
    host: config.NAS_SSH_HOST,
    port: Number(config.NAS_SSH_PORT || 22),
    username: config.NAS_SSH_USERNAME
  };

  if (config.NAS_SSH_PRIVATE_KEY) {
    sshConfig.privateKey = config.NAS_SSH_PRIVATE_KEY.replace(/\\n/g, "\n");
  } else if (config.NAS_SSH_PASSWORD) {
    sshConfig.password = config.NAS_SSH_PASSWORD;
  } else {
    throw new Error("NAS SSH password or private key is required.");
  }

  return sshConfig;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runSshCommand(config, command) {
  const sshConfig = ensureSshCredentials(config);
  console.log("[nas][ssh] Executing:", command);

  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    let stdout = "";
    let stderr = "";

    client
      .on("ready", () => {
        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }

          stream
            .on("close", (code) => {
              client.end();
              if (code !== 0) {
                return reject(
                  new Error(
                    stderr.trim() || `SSH command failed with exit code ${code}`
                  )
                );
              }
              resolve(stdout.trim());
            })
            .on("data", (data) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err) => {
        reject(err);
      })
      .connect(sshConfig);
  });
}

/**
 * Recursively calculate size + file count for a local path.
 */
async function walkPath(targetPath) {
  const stats = await fs.promises.stat(targetPath);

  if (stats.isDirectory()) {
    const children = await fs.promises.readdir(targetPath);
    let bytes = 0;
    let files = 0;

    for (const child of children) {
      const childPath = path.join(targetPath, child);
      const childStats = await walkPath(childPath);
      bytes += childStats.bytes;
      files += childStats.files;
    }

    return { bytes, files };
  }

  return { bytes: stats.size, files: 1 };
}

async function summarizeRecycleBinLocal(recyclePath, { previewLimit = 5 } = {}) {
  const exists = fs.existsSync(recyclePath);
  if (!exists) {
    throw new Error(`Recycle bin path does not exist: ${recyclePath}`);
  }

  const dirents = await fs.promises.readdir(recyclePath, { withFileTypes: true });

  const entries = [];
  let totalBytes = 0;
  let totalFiles = 0;

  for (const dirent of dirents) {
    const fullPath = path.join(recyclePath, dirent.name);
    const { bytes, files } = await walkPath(fullPath);

    totalBytes += bytes;
    totalFiles += files;

    entries.push({
      name: dirent.name,
      type: dirent.isDirectory() ? "directory" : "file",
      sizeBytes: bytes,
      fileCount: files
    });
  }

  entries.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    totalBytes,
    totalFiles,
    entryCount: entries.length,
    entries,
    preview: entries.slice(0, previewLimit)
  };
}

async function summarizeRecycleBinRemote(recyclePath, config, { previewLimit = 5 } = {}) {
  const script = `
path=${shellQuote(recyclePath)}
if [ ! -d "$path" ]; then
  echo "__MISSING__"
  exit 0
fi
total_bytes=$(du -sb "$path" | cut -f1)
total_files=$(find "$path" -type f | wc -l | tr -d '[:space:]')
entry_count=$(ls -A "$path" 2>/dev/null | wc -l | tr -d '[:space:]')
echo "__SUMMARY__:$total_bytes:$total_files:$entry_count"
ls -A "$path" 2>/dev/null | head -n ${previewLimit} | while IFS= read -r entry; do
  size=$(du -sb "$path/$entry" | cut -f1)
  printf "__ENTRY__:%s:%s\\n" "$entry" "$size"
done
`.trim();

  const command = `/bin/sh -c ${shellQuote(script)}`;
  console.log("[nas][ssh] Summarizing recycle bin:", recyclePath);
  const output = await runSshCommand(config, command);

  if (output.includes("__MISSING__")) {
    throw new Error(`Recycle bin path does not exist: ${recyclePath}`);
  }

  const lines = output.split("\n").filter(Boolean);
  const preview = [];
  let totalBytes = 0;
  let totalFiles = 0;
  let entryCount = 0;

  for (const line of lines) {
    if (line.startsWith("__SUMMARY__:")) {
      const [, bytes, files, entries] = line.split(":");
      totalBytes = Number(bytes || 0);
      totalFiles = Number(files || 0);
      entryCount = Number(entries || 0);
    } else if (line.startsWith("__ENTRY__:")) {
      const [, name, size] = line.split(":");
      preview.push({
        name,
        type: "unknown",
        sizeBytes: Number(size || 0),
        fileCount: 0
      });
    }
  }

  const result = {
    totalBytes,
    totalFiles,
    entryCount,
    entries: [],
    preview
  };
  console.log(
    "[nas][ssh] Summary result",
    recyclePath,
    "size=",
    totalBytes,
    "files=",
    totalFiles,
    "entries=",
    entryCount
  );
  return result;
}

async function emptyRecycleBinLocal(recyclePath) {
  const entries = await fs.promises.readdir(recyclePath);
  let deletedCount = 0;

  for (const entry of entries) {
    const target = path.join(recyclePath, entry);
    await fs.promises.rm(target, { recursive: true, force: true });
    deletedCount++;
  }

  return deletedCount;
}

async function emptyRecycleBinRemote(recyclePath, config) {
  const script = `
path=${shellQuote(recyclePath)}
if [ ! -d "$path" ]; then
  echo "__REMOVED__:0"
  exit 0
fi
count=$(ls -A "$path" 2>/dev/null | wc -l | tr -d '[:space:]')
rm -rf "$path"/* "$path"/.[!.]* "$path"/..?* 2>/dev/null
echo "__REMOVED__:$count"
`.trim();

  const command = `/bin/sh -c ${shellQuote(script)}`;
  console.log("[nas][ssh] Clearing recycle bin:", recyclePath);
  const output = await runSshCommand(config, command);
  const match = output.match(/__REMOVED__:(\d+)/);
  const removed = match ? Number(match[1]) : 0;
  console.log("[nas][ssh] Cleared recycle bin:", recyclePath, "removed entries=", removed);
  return removed;
}

async function discoverRecycleBinsLocal(shareRoots = []) {
  const seen = new Set();
  const bins = [];

  for (const rawRoot of shareRoots) {
    if (!rawRoot) continue;

    const root = path.resolve(rawRoot);
    if (!fs.existsSync(root)) continue;

    const stats = await fs.promises.stat(root);
    if (!stats.isDirectory()) continue;

    if (path.basename(root) === "@Recycle") {
      const share = path.basename(path.dirname(root));
      const key = root;
      if (!seen.has(key)) {
        seen.add(key);
        bins.push({ share, recyclePath: root });
      }
      continue;
    }

    const directRecycle = path.join(root, "@Recycle");
    if (fs.existsSync(directRecycle)) {
      const share = path.basename(root);
      const key = directRecycle;
      if (!seen.has(key)) {
        seen.add(key);
        bins.push({ share, recyclePath: directRecycle });
      }
      continue;
    }

    const dirents = await fs.promises.readdir(root, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const sharePath = path.join(root, dirent.name);
      const recyclePath = path.join(sharePath, "@Recycle");
      if (fs.existsSync(recyclePath)) {
        const key = recyclePath;
        if (!seen.has(key)) {
          seen.add(key);
          bins.push({ share: dirent.name, recyclePath });
        }
      }
    }
  }

  return bins;
}

async function discoverRecycleBinsRemote(shareRoots = [], config) {
  const seen = new Set();
  const bins = [];

  for (const root of shareRoots) {
    if (!root) continue;

    const script = `
root=${shellQuote(root)}
if [ -d "$root" ]; then
  find "$root" -mindepth 1 -maxdepth 2 -type d -name '@Recycle' -print
fi
`.trim();

    const command = `/bin/sh -c ${shellQuote(script)}`;
    console.log("[nas][ssh] Scanning root:", root);
    const output = await runSshCommand(config, command);
    const lines = output ? output.split("\n") : [];

    for (const recyclePath of lines) {
      if (!recyclePath) continue;
      const key = recyclePath.trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const share = posixPath.basename(posixPath.dirname(key));
      bins.push({ share, recyclePath: key });
    }
  }

  return bins;
}

export async function discoverRecycleBins(shareRoots = [], config = {}) {
  if (hasSsh(config)) {
    return await discoverRecycleBinsRemote(shareRoots, config);
  }

  return await discoverRecycleBinsLocal(shareRoots);
}

export async function summarizeRecycleBin(recyclePath, options = {}, config = {}) {
  if (hasSsh(config)) {
    return await summarizeRecycleBinRemote(recyclePath, config, options);
  }

  return await summarizeRecycleBinLocal(recyclePath, options);
}

export async function emptyRecycleBin(recyclePath, config = {}) {
  if (hasSsh(config)) {
    return await emptyRecycleBinRemote(recyclePath, config);
  }

  return await emptyRecycleBinLocal(recyclePath);
}

function parseDfOutput(output) {
  const lines = output.trim().split(/\n+/);
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, blocks, used, available, percent, mount] = parts;
    entries.push({ filesystem, blocks, used, available, percent, mount });
  }
  return entries;
}

async function getStorageStatusRemote(shareRoots = [], config) {
  const rootsArg = shareRoots.map((r) => shellQuote(r)).join(" ");
  const command = `/bin/df -P -B1 ${rootsArg}`;
  const output = await runSshCommand(config, command);
  if (!output) {
    console.warn("[nas][ssh] df returned empty output for", shareRoots);
  }
  let entries = parseDfOutput(output || "");

  // Fallback: full df and filter mounts matching roots
  if (entries.length === 0) {
    const fallbackOutput = await runSshCommand(config, "/bin/df -P -B1");
    entries = parseDfOutput(fallbackOutput || "").filter((e) =>
      shareRoots.some((root) => e.mount?.startsWith(root))
    );
  }

  return entries.map((e) => ({
    path: e.mount,
    mount: e.mount,
    totalBytes: Number(e.blocks || 0),
    usedBytes: Number(e.used || 0),
    availableBytes: Number(e.available || 0),
    usedPercent: Number((e.percent || "0").replace(/%/g, ""))
  }));
}

async function getStorageStatusLocal(shareRoots = []) {
  const results = [];
  for (const root of shareRoots) {
    if (!root) continue;
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        execFile("df", ["-P", "-B1", root], (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve({ stdout, stderr });
        });
      });
      const entries = parseDfOutput(stdout || "");
      entries.forEach((e) => {
        results.push({
          path: root,
          mount: e.mount,
          totalBytes: Number(e.blocks || 0),
          usedBytes: Number(e.used || 0),
          availableBytes: Number(e.available || 0),
          usedPercent: Number((e.percent || "0").replace(/%/g, ""))
        });
      });
    } catch (err) {
      console.error("[nas][local] Failed to run df for", root, err.message);
    }
  }
  return results;
}

export async function getStorageStatus(shareRoots = [], config = {}) {
  if (hasSsh(config)) {
    return await getStorageStatusRemote(shareRoots, config);
  }
  return await getStorageStatusLocal(shareRoots);
}

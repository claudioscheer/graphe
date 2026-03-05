const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'out');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(fullPath);
      continue;
    }
    total += fs.statSync(fullPath).size;
  }
  return total;
}

if (!fs.existsSync(outDir)) {
  console.error(`Package output not found: ${outDir}`);
  process.exit(1);
}

const entries = fs
  .readdirSync(outDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const fullPath = path.join(outDir, entry.name);
    return {
      name: entry.name,
      size: directorySize(fullPath),
    };
  })
  .sort((a, b) => b.size - a.size);

if (entries.length === 0) {
  console.error(`No packaged app directories found in ${outDir}`);
  process.exit(1);
}

console.log(`Packaged outputs: ${outDir}`);
for (const entry of entries) {
  console.log(`${formatBytes(entry.size).padStart(9)}  ${entry.name}`);
}

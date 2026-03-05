const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist', 'renderer');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    const stat = fs.statSync(fullPath);
    files.push({
      path: path.relative(distDir, fullPath),
      size: stat.size,
    });
  }
  return files;
}

if (!fs.existsSync(distDir)) {
  console.error(`Renderer build not found: ${distDir}`);
  process.exit(1);
}

const files = walk(distDir).sort((a, b) => b.size - a.size);
const total = files.reduce((sum, file) => sum + file.size, 0);

console.log(`Renderer output: ${distDir}`);
console.log(`Total size: ${formatBytes(total)}`);
for (const file of files.slice(0, 10)) {
  console.log(`${formatBytes(file.size).padStart(9)}  ${file.path}`);
}

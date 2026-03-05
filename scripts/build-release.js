#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const tagName = `v${version}`;

const allowedExtensions = new Set([
  '.dmg',
  '.deb',
  '.appimage',
  '.rpm',
  '.exe',
  '.msi',
  '.pkg',
  '.zip',
]);

const platformMap = {
  linux: {
    workflowName: 'linux',
    npmScript: 'make:linux',
    supportedHosts: new Set(['linux']),
  },
  mac: {
    workflowName: 'mac',
    npmScript: 'make:mac',
    supportedHosts: new Set(['darwin']),
  },
  win: {
    workflowName: 'win',
    npmScript: 'make:win',
    supportedHosts: new Set(['win32']),
  },
};

function printHelp() {
  console.log(`Build local release artifacts that match the GitHub release workflow.

Usage:
  node scripts/build-release.js [options]

Options:
  --platform <linux|mac|win>      Platform build target. Default: current host platform
  --skip-install                  Skip npm ci
  --skip-release                  Do not create/upload the GitHub release
  --assets-dir <path>             Output directory for collected release assets
  --tag <tag>                     Override release tag. Default: ${tagName}
  --help                          Show this help

Notes:
  - This mirrors the workflow steps: npm ci, build CSS, npm run make:<platform>, collect out/make artifacts.
  - Native desktop targets still require the matching host OS, same as the GitHub workflow.
`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    platform: hostPlatformName(),
    skipInstall: false,
    skipRelease: false,
    assetsDir: path.join(repoRoot, 'release-assets'),
    tag: tagName,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--skip-install') {
      options.skipInstall = true;
      continue;
    }

    if (arg === '--skip-release') {
      options.skipRelease = true;
      continue;
    }

    if (arg === '--platform') {
      options.platform = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--platform=')) {
      options.platform = arg.slice('--platform='.length);
      continue;
    }

    if (arg === '--assets-dir') {
      options.assetsDir = path.resolve(repoRoot, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--assets-dir=')) {
      options.assetsDir = path.resolve(repoRoot, arg.slice('--assets-dir='.length));
      continue;
    }

    if (arg === '--tag') {
      options.tag = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--tag=')) {
      options.tag = arg.slice('--tag='.length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!options.platform) {
    fail('Could not determine a default platform for this host. Pass --platform explicitly.');
  }

  if (!platformMap[options.platform]) {
    fail(`Unsupported platform "${options.platform}". Use one of: linux, mac, win.`);
  }

  return options;
}

function hostPlatformName() {
  if (process.platform === 'linux') {
    return 'linux';
  }

  if (process.platform === 'darwin') {
    return 'mac';
  }

  if (process.platform === 'win32') {
    return 'win';
  }

  return null;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function assertSupportedHost(platform) {
  const config = platformMap[platform];
  if (!config.supportedHosts.has(process.platform)) {
    fail(
      `Target "${platform}" must be built on ${Array.from(config.supportedHosts).join(', ')}. Current host: ${process.platform}.`
    );
  }
}

function removeDirectoryContents(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function walkFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectArtifacts(outputDir) {
  const makeDir = path.join(repoRoot, 'out', 'make');
  if (!fs.existsSync(makeDir)) {
    fail(`Expected build output in ${makeDir}, but it does not exist.`);
  }

  removeDirectoryContents(outputDir);

  const copied = [];
  for (const file of walkFiles(makeDir)) {
    const extension = path.extname(file).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      continue;
    }

    const destination = path.join(outputDir, path.basename(file));
    fs.copyFileSync(file, destination);
    copied.push(destination);
  }

  if (copied.length === 0) {
    fail(`No release artifacts found under ${makeDir}.`);
  }

  return copied;
}

function ensureGhRelease(tag) {
  if (!commandExists('gh')) {
    fail('GitHub CLI "gh" is required for release creation/upload.');
  }

  const view = spawnSync('gh', ['release', 'view', tag], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  if (view.status === 0) {
    console.log(`GitHub release ${tag} already exists.`);
    return;
  }

  console.log(`Creating GitHub release ${tag}.`);
  run('gh', ['release', 'create', tag, '--title', tag, '--generate-notes']);
}

function uploadReleaseAssets(tag, assets) {
  if (assets.length === 0) {
    return;
  }

  console.log(`Uploading ${assets.length} asset(s) to GitHub release ${tag}.`);
  run('gh', ['release', 'upload', tag, '--clobber', ...assets]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = [options.platform];

  for (const target of targets) {
    assertSupportedHost(target);
  }

  console.log(`Version: ${version}`);
  console.log(`Tag: ${options.tag}`);
  console.log(`Targets: ${targets.join(', ')}`);

  if (!options.skipInstall) {
    run(npmCommand(), ['ci']);
  }

  run(npmCommand(), ['run', 'build:css']);
  fs.rmSync(path.join(repoRoot, 'out', 'make'), { recursive: true, force: true });

  for (const target of targets) {
    const targetConfig = platformMap[target];
    const env =
      targetConfig.workflowName === 'linux'
        ? { DEBUG: 'electron-forge:*,electron-installer-debian*' }
        : undefined;

    console.log(`Building ${targetConfig.workflowName} artifacts with npm run ${targetConfig.npmScript}.`);
    run(npmCommand(), ['run', targetConfig.npmScript], { env });
  }

  const assets = collectArtifacts(options.assetsDir);
  console.log(`Collected ${assets.length} artifact(s) into ${options.assetsDir}.`);

  if (options.skipRelease) {
    return;
  }

  ensureGhRelease(options.tag);
  uploadReleaseAssets(options.tag, assets);
}

main();

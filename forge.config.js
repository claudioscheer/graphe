const path = require('path');
const { spawnSync } = require('child_process');

const appIconBase = path.join(__dirname, 'assets', 'graphe');
const appIconPng = `${appIconBase}.png`;
const executableName = 'graphe-bible';

function getGitIgnoredDirectoryPatterns() {
  const result = spawnSync(
    'git',
    ['ls-files', '--others', '-i', '--exclude-standard', '--directory'],
    {
      cwd: __dirname,
      encoding: 'utf8',
    }
  );

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('/'))
    .filter((line) => line !== 'node_modules/')
    .map((line) => `^/${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

module.exports = {
  packagerConfig: {
    asar: true,
    icon: appIconBase,
    executableName,
    ignore: [
      ...getGitIgnoredDirectoryPatterns(),
      '^/test($|/)',
      '^/scripts($|/)',
      '^/src/renderer($|/)',
      '^/data($|/)',
      '^/README\\.md$',
      '^/CLAUDE\\.md$',
      '^/MyBibleModulesFormat\\.md$',
      '^/TODO\\.md$',
      '^/package-lock\\.json$',
      '^/eslint\\.config\\.js$',
      '^/vitest\\.config\\.js$',
      '^/vite\\.renderer\\.config\\.mjs$',
      '^/dist/renderer/.*\\.map$',
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: appIconPng,
        },
      },
    },
    {
      name: '@reforged/maker-appimage',
      config: {
        options: {
          icon: appIconPng,
        },
      },
    },
    {
      name: '@electron-forge/maker-wix',
      config: {
        name: 'Graphe',
        exe: executableName,
        manufacturer: 'Claudio Scheer',
        description:
          'O Graphe oferece uma interface limpa e atual para leitura, pesquisa e análise profunda das Escrituras, com suporte a painéis divididos, números de Strong, referências cruzadas e múltiplas traduções.',
        icon: path.join(__dirname, 'assets', 'graphe.ico'),
        arch: 'x64',
        upgradeCode: 'e4657921-7180-4078-b6d9-c38405956c0b',
        ui: {
          chooseDirectory: true,
        },
      },
    },
  ],
};

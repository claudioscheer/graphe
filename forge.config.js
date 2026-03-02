const path = require('path');

const appIconBase = path.join(__dirname, 'assets', 'graphe');
const appIconPng = `${appIconBase}.png`;
const executableName = 'graphe-bible';

module.exports = {
  packagerConfig: {
    asar: true,
    icon: appIconBase,
    executableName,
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

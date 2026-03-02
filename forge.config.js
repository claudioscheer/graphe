const path = require('path');

const appIconBase = path.join(__dirname, 'assets', 'graphe');
const appIconPng = `${appIconBase}.png`;

module.exports = {
  packagerConfig: {
    asar: true,
    icon: appIconBase,
  },
  makers: [
    { name: '@electron-forge/maker-zip' },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: appIconPng,
        },
      },
    },
  ],
};

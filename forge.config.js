const path = require('path');

const appIcon = path.join(__dirname, 'assets', 'graphe.png');

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: ['data'],
    icon: appIcon,
  },
  makers: [
    { name: '@electron-forge/maker-zip' },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: appIcon,
        },
      },
    },
  ],
};

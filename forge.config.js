module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: ['data'],
  },
  makers: [
    { name: '@electron-forge/maker-zip' },
    { name: '@electron-forge/maker-deb', config: {} },
  ],
};

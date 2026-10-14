module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: 'fr.maxjeune.planner',
    name: 'MAX Jeune Planner',
    executableName: 'max-jeune-planner',
    ignore: [
      /^\/\.git(?:\/|$)/,
      /^\/\.cache(?:\/|$)/,
      /^\/\.DS_Store$/,
      /^\/Code Audit - v1(?:\/|$)/,
      /^\/Resdesign(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/audit-.*\.js$/,
      /^\/sncf-max-main\.zip$/,
      /^\/README\.md$/,
      /^\/out(?:\/|$)/,
      /^\/node_modules(?:\/|$)/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
};

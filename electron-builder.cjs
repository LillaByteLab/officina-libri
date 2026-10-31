// Deliberate allowlist: no books, test output, Android files or credentials.
module.exports = {
  appId: 'app.officinalibri.public',
  productName: 'Officina Libri Beta',
  directories: { output: 'release/windows' },
  files: ['desktop/**', 'packages/**', 'dist/**', 'package.json', 'LICENSE'],
  asar: false, // Native modules and the Typst child process use real paths.
  npmRebuild: false, // The pinned sharp/Typst modules expose N-API binaries.
  electronDist: 'node_modules/electron/dist',
  afterPack: './scripts/verify-windows.cjs',
  win: {
    target: 'nsis',
    executableName: 'Officina Libri Beta',
    icon: 'output/windows-build/icon.ico',
    signExecutable: false,
    requestedExecutionLevel: 'asInvoker',
    artifactName: 'Officina-Libri-Public-${version}-Windows-${arch}-Setup.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Officina Libri Beta',
    installerLanguages: ['it_IT'],
    runAfterFinish: false,
    packElevateHelper: false
  },
  publish: null
};

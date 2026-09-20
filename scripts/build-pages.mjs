import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const outputDirectory = 'dist';

// Explicit allow-list: only files required by the browser are published.
const publicFiles = [
  '_headers',
  'airwallet-flow.js',
  'button-display-mode.js',
  'cokeon-flow.js',
  'device-access.js',
  'fonts/Corporate-Logo-Bold-ver3.otf',
  'fonts/Corporate-Logo-Rounded-Bold-ver3.woff2',
  'home-layout-admin.html',
  'home-layout-edit.html',
  'home-layout-marker-core.js',
  'home-layout-monthly-history.html',
  'home-layout-read.html',
  'home-layout.html',
  'icon-any-192.png',
  'icon-any.png',
  'icon-maskable.png',
  'icon-transparent-192.png',
  'icon-transparent-512.png',
  'index.html',
  'layout-account-reset-ui.js',
  'layout-backup-share.js',
  'manifest.json',
  'manifest.webmanifest',
  'pwa-diagnostic/index.html',
  'pwa-diagnostic/manifest.webmanifest',
  'pwa-diagnostic/sw.js',
  'revenue-deduction.js',
  'robots.txt',
  'share.html',
  'sw.js',
  'temporary-card-diagnostics.js',
  'temporary-card-tools-v2.js',
  'temporary-card-tools-v3.js',
  'temporary-card-tools.js'
];

await rm(outputDirectory, { recursive: true, force: true });

for (const relativePath of publicFiles) {
  const destination = join(outputDirectory, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(relativePath, destination);
}

console.log(`Prepared ${publicFiles.length} production assets in ${outputDirectory}/`);

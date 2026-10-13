import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import manifest from './manifest.config.ts';

/**
 * The content script is injected with `chrome.scripting`, which needs no web-accessible
 * resource. The build plugin lists it anyway, and that would let any site detect the extension.
 */
function dropWebAccessibleResources(): Plugin {
  let manifestPath = '';
  return {
    name: 'drop-web-accessible-resources',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      manifestPath = resolve(config.root, config.build.outDir, 'manifest.json');
    },
    // The manifest is only final once every other plugin has written its output.
    async closeBundle() {
      const built = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      delete built.web_accessible_resources;
      await writeFile(manifestPath, `${JSON.stringify(built, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [preact(), crx({ manifest }), dropWebAccessibleResources()],
  build: { target: 'chrome116', sourcemap: true },
});

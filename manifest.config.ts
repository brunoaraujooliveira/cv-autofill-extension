import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from './package.json' with { type: 'json' };
import { PROVIDER_HOST_PERMISSION } from './src/background/llm/provider-config.ts';

/** The e2e build talks to a local stand-in for the provider and fills local fixture pages. */
const E2E_HOST_PERMISSIONS = ['http://localhost/*', 'http://127.0.0.1/*'];

export default defineManifest(({ mode }) => ({
  manifest_version: 3,
  name: 'CV Autofill',
  description: packageJson.description,
  version: packageJson.version,
  minimum_chrome_version: '116',
  action: { default_title: 'CV Autofill' },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  options_page: 'src/options/index.html',
  permissions: ['storage', 'sidePanel', 'activeTab', 'scripting'],
  host_permissions: [PROVIDER_HOST_PERMISSION, ...(mode === 'e2e' ? E2E_HOST_PERMISSIONS : [])],
  // Requested one origin at a time, when a form embeds a frame from another site.
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+Shift+A' },
      description: 'Open the side panel for this tab',
    },
    'fill-page': {
      suggested_key: { default: 'Alt+Shift+F' },
      description: 'Fill the form in this tab',
    },
    'next-step': {
      suggested_key: { default: 'Alt+Shift+N' },
      description: 'Go to the next step after reviewing',
    },
  },
}));

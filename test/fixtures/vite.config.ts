import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const PAGES = [
  '01-plain/index',
  '02-react/index',
  '03-wizard/index',
  '04-conditional/index',
  '05-repeatable/index',
  '06-combobox/index',
  '07-shadow/index',
  '08-iframe/index',
  '08-iframe/inner',
  '09-validation/index',
  '10-gated-list/index',
];

/** Builds the pages the e2e suite fills in. They are served under /fixtures/ by the test server. */
export default defineConfig({
  root: here('./pages'),
  base: '/fixtures/',
  logLevel: 'warn',
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((page) => [page, here(`./pages/${page}.html`)])),
    },
  },
});

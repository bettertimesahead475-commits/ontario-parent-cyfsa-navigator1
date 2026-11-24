import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'child_process';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * On Cloudflare Pages Git builds only (CF_PAGES=1), precompile Pages Functions with the repo's pinned
 * wrangler 4 into dist/_worker.js, exactly as CI and the direct-upload release script do.
 *
 * Without this, Pages compiles /functions itself with its built-in wrangler 3.114.17, whose bundle
 * breaks unpdf ("PDF.js could not be resolved"): every PDF, even a native-text one, then falls
 * through to Gemini OCR. When dist/_worker.js exists, Pages uses it instead of /functions.
 * Local and CI builds are unchanged.
 */
function cloudflarePagesFunctionsBundle(): Plugin {
  return {
    name: 'cloudflare-pages-functions-bundle',
    apply: 'build',
    closeBundle() {
      if (process.env.CF_PAGES !== '1') return;
      const wranglerBin = path.resolve(__dirname, 'node_modules/wrangler/bin/wrangler.js');
      execFileSync(process.execPath, [
        wranglerBin, 'pages', 'functions', 'build', 'functions',
        '--outdir=dist/_worker.js',
        '--output-routes-path=dist/_routes.json',
        '--build-output-directory=dist',
        '--compatibility-date=2026-10-29',
      ], { stdio: 'inherit', cwd: __dirname });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cloudflarePagesFunctionsBundle()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
    build: {
      cssCodeSplit: true,
      chunkSizeWarningLimit: 800,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

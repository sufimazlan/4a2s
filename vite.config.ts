import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

// MediaPipe's WASM runtime is served from our own origin (not a CDN) so the
// game keeps working when a CDN is blocked, and so the service worker can cache it.
const MEDIAPIPE_WASM_DIR = join(dirname(require.resolve('@mediapipe/tasks-vision')), 'wasm');
const MEDIAPIPE_WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];
const MEDIAPIPE_URL_PREFIX = '/mediapipe/wasm/';

function mediapipeWasm(): Plugin {
  return {
    name: '4a2s:mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!path.startsWith(MEDIAPIPE_URL_PREFIX)) return next();
        const file = path.slice(MEDIAPIPE_URL_PREFIX.length);
        if (!MEDIAPIPE_WASM_FILES.includes(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(MEDIAPIPE_WASM_DIR, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of MEDIAPIPE_WASM_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: MEDIAPIPE_URL_PREFIX.slice(1) + file,
          source: readFileSync(join(MEDIAPIPE_WASM_DIR, file)),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // `npm run dev:https` — camera access on a phone over LAN needs HTTPS.
    mode === 'https' && basicSsl(),
    mediapipeWasm(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: '4a2s',
        short_name: '4a2s',
        description: 'A multiplayer 3D game where your character wears your face and your expressions.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0d0f1a',
        theme_color: '#0d0f1a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached. The large MediaPipe runtime and model are
        // cached the first time the face scan is opened instead.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['mediapipe/**'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith(MEDIAPIPE_URL_PREFIX),
            handler: 'CacheFirst',
            options: { cacheName: 'mediapipe-wasm', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/mediapipe-models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe-models',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
}));

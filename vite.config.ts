import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// PWA strategy:
//   • registerType 'prompt' — the service worker installs silently, but the
//     refresh-to-update step is gated behind an in-app toast so users don't
//     get a jarring reload mid-task. UpdatePrompt.tsx consumes the prompt.
//   • includeAssets — non-fingerprinted public/ files that the SW should
//     precache so the install screen + offline shell render without network.
//   • runtime caching — Google Fonts CSS + WOFF2 served stale-while-revalidate
//     for 1y so a flaky network doesn't crash typography in standalone mode.
//
// The manifest below is the source of truth — VitePWA injects the <link
// rel="manifest"> tag automatically, so we deleted the static one in
// index.html. Colors track the Swiss Calm Authority palette
// (warm-white background, ledger-green theme).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      includeAssets: [
        "atheon-icon.svg",
        "apple-touch-icon.png",
        "favicon-96.png",
      ],
      manifest: {
        name: "Atheon Intelligence Platform",
        short_name: "Atheon",
        description:
          "Enterprise Intelligence Platform — Executive, Process, and Autonomous layers.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#fbfaf7",
        theme_color: "#0a7d4f",
        categories: ["business", "productivity", "finance"],
        lang: "en",
        icons: [
          {
            src: "/atheon-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/atheon-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/atheon-icon-192-maskable.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/atheon-icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Don't cache HTML — the auth gate must always see fresh markup so
        // a logged-out shell isn't replayed to a logged-in user from cache.
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Keep the SW disabled in `vite dev` — service workers and HMR conflict.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

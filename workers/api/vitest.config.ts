import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        main: './src/index.ts',
        miniflare: {
          compatibilityDate: '2024-12-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'test-db' },
          kvNamespaces: { CACHE: 'test-cache' },
          r2Buckets: { STORAGE: 'test-storage' },
          bindings: {
            ENVIRONMENT: 'test',
            JWT_SECRET: 'test-jwt-secret-32chars-minimum!',
            ENCRYPTION_KEY: 'test-encryption-key-32chars-min!',
            SETUP_SECRET: 'test-setup-secret-for-testing123',
            OLLAMA_API_KEY: 'test-ollama-key',
            MS_GRAPH_CLIENT_ID: 'test',
            MS_GRAPH_CLIENT_SECRET: 'test',
            MS_GRAPH_TENANT_ID: 'test',
            AZURE_AD_CLIENT_ID: 'test',
            AZURE_AD_CLIENT_SECRET: 'test',
            AZURE_AD_TENANT_ID: 'test',
          },
        },
      },
    },
  },
});

/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/v2/',
    build: {
        outDir: '../public-site/v2',
        emptyOutDir: true,
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
    },
});

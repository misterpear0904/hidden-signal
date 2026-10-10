import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NO_HMR=1 (npm run dev:full) disables hot-module patching: every save does a
// full browser reload instead. Slower feedback, but immune to stale/half-
// patched module mixes while iterating quickly.
const NO_HMR = process.env.NO_HMR === '1';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    hmr: NO_HMR ? false : true,
  },
})

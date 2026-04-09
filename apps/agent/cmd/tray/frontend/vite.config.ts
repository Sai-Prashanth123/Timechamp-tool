import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Wails injects its own runtime at /wails/ipc.js; exclude from optimization
  optimizeDeps: {
    exclude: ['@wailsapp/runtime'],
  },
})

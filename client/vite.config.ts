import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    }
  }
})

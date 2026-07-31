import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Star sync / OAuth live on the Node server (`npm start`).
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Preserve the browser origin so OAuth redirect_uri matches Vite.
            if (req.headers.host) {
              proxyReq.setHeader('x-forwarded-host', req.headers.host)
            }
            proxyReq.setHeader('x-forwarded-proto', 'http')
          })
        },
      },
    },
  },
})

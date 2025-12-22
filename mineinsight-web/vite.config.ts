import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Roblox thumbnails
      "/rbx-thumbnails": {
        target: "https://thumbnails.roblox.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rbx-thumbnails/, ""),
      },  
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite' // 1. Импортируем

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // 2. Добавляем в список плагинов
  ],
  // Настройки порта, которые мы делали раньше
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      '/api/agent': 'http://127.0.0.1:3001',
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
})

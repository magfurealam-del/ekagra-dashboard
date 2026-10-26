import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/postcss'
import { fileURLToPath } from 'node:url'
const path = (value: string) => fileURLToPath(new URL(value, import.meta.url))
export default defineConfig({
  root: path('./'),
  envDir: path('./'),
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  resolve: {
    alias: [
      { find: '@/lib/AuthContext', replacement: path('./mock-auth.tsx') },
      { find: '@/lib/supabase', replacement: path('./mock-data.ts') },
      { find: 'next/navigation', replacement: path('./mock-navigation.ts') },
      { find: 'next/link', replacement: path('./mock-link.tsx') },
      { find: '@', replacement: path('../') },
    ],
  },
  css: { postcss: { plugins: [tailwind()] } },
})

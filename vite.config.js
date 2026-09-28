import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { wgslVitePlugin } from 'vgpu/client'
import { fileURLToPath } from 'node:url'

const page = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), wgslVitePlugin({ minify: true })],
  build: {
    rollupOptions: {
      input: {
        main: page('./index.html'),
        labs: page('./labs/index.html'),
        fieldnote: page('./labs/fieldnote/index.html'),
      },
    },
  },
})

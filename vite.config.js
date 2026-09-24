import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const page = (p) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
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

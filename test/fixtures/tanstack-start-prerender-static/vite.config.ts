import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    tanstackStart({
      prerender: {
        enabled: true,
      },
    }),
  ],
})

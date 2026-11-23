import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the build works on GitHub Pages project sites
  // (username.github.io/repo-name/) as well as custom domains.
  base: './',
})

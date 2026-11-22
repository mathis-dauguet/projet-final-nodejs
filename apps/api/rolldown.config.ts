import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/main.ts',
  platform: 'node',
  external: ['pg', 'bcryptjs', 'jsonwebtoken'],
  output: { dir: 'dist', format: 'esm' },
})
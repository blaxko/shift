import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'crank/**/*.test.ts', 'app/src/domain/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Integration tests run against a real PostgreSQL database named by TEST_DATABASE_URL
 * (CI service container, Docker, or `pnpm db:start`). Migrations are applied before the suite.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set; integration tests need a dedicated PostgreSQL database');
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error('Refusing to run integration tests: TEST_DATABASE_URL database name must contain "test"');
  }
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

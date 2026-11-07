// Starts a real PostgreSQL server (binaries from the embedded-postgres npm package)
// for machines without Docker. Data persists in .data/postgres.
// Usage: node scripts/dev-db.mjs [--port 5432]
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const portArg = process.argv.indexOf('--port');
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : Number(process.env.PGPORT ?? 5432);
const databaseDir = path.join(root, '.data', 'postgres');

const pg = new EmbeddedPostgres({
  databaseDir,
  user: process.env.PGUSER ?? 'qtm',
  password: process.env.PGPASSWORD ?? 'qtm_dev_password',
  port,
  persistent: true,
  onLog: () => {},
});

const firstRun = !existsSync(databaseDir);
if (firstRun) await pg.initialise();
await pg.start();
for (const db of ['qtm_dev', 'qtm_test']) {
  try {
    await pg.createDatabase(db);
  } catch (error) {
    if (!String(error).includes('already exists')) throw error;
  }
}
console.info(`PostgreSQL ready on port ${port} (databases: qtm_dev, qtm_test). Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

import { dropAll, runMigrations } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

(async () => {
  await dropAll(url);
  const { applied } = await runMigrations(url);
  console.log(`Reset complete. Applied ${applied.length} migrations.`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

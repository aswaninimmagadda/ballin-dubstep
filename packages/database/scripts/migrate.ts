import { runMigrations } from '../src/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

runMigrations(url)
  .then(({ applied, skipped }) => {
    console.log(`Applied ${applied.length} migration(s):`, applied.join(', ') || '(none)');
    console.log(`Already applied: ${skipped.length}`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

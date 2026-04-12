// One-shot read-only audit — lists public tables + row counts so we can
// decide what to wipe. No writes. Safe to run any time.
//
//   node scripts/db-audit.js
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const results = [];
    for (const { table_name } of tables) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM public."${table_name}"`,
      );
      results.push({ table: table_name, rows: rows[0].n });
    }

    const maxName = Math.max(...results.map(r => r.table.length));
    console.log('\nTable'.padEnd(maxName + 2) + 'Rows');
    console.log('-'.repeat(maxName + 12));
    for (const r of results) {
      console.log(r.table.padEnd(maxName + 2) + r.rows.toLocaleString());
    }
    console.log(`\n${results.length} tables in public schema`);
  } finally {
    await client.end();
  }
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});

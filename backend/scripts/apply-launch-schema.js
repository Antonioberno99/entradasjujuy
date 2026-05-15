const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [tableName]
  );
  return rows[0].exists;
}

async function runSqlFile(client, relativePath) {
  const fullPath = path.join(root, relativePath);
  const sql = fs.readFileSync(fullPath, 'utf8');
  await client.query(sql);
  console.log(`[DB] Aplicado ${relativePath}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no configurado');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  try {
    const hasUsuarios = await tableExists(client, 'usuarios');
    if (!hasUsuarios) {
      await runSqlFile(client, 'schema.sql');
    } else {
      console.log('[DB] Schema base ya existe');
    }

    await runSqlFile(client, 'migrations/001_auth_google.sql');
    await runSqlFile(client, 'migrations/002_publicaciones.sql');
    await runSqlFile(client, 'migrations/003_email_verification.sql');
    await runSqlFile(client, 'migrations/004_mp_marketplace.sql');
    await runSqlFile(client, 'migrations/005_mp_oauth_pkce.sql');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[DB] Error aplicando schema:', err.message);
  process.exit(1);
});

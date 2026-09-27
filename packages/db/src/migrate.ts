/**
 * @file packages/db/src/migrate.ts
 * @node 11.02
 * @description Hand-rolled sequential SQL migration runner.
 * Reads numbered .sql files from the migrations directory in order and applies unapplied ones.
 */
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    // Ensure the migrations tracking table exists first
    const bootstrapSql = await readFile(
      join(__dirname, "../migrations/000_schema_migrations.sql"),
      "utf8",
    );
    await client.query(bootstrapSql);

    // Collect all migration files except the bootstrap
    const migrationsDir = join(__dirname, "../migrations");
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql") && f !== "000_schema_migrations.sql")
      .sort();

    for (const file of files) {
      // Check if already applied
      const { rows } = await client.query<{ filename: string }>(
        "SELECT filename FROM schema_migrations WHERE filename = $1",
        [file],
      );
      if ((rows[0]) !== undefined) {
        process.stdout.write(`[migrate] Already applied: ${file}\n`);
        continue;
      }

      // Apply migration in a transaction
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(filename) VALUES($1)",
          [file],
        );
        await client.query("COMMIT");
        process.stdout.write(`[migrate] Applied: ${file}\n`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    process.stdout.write("[migrate] All migrations complete.\n");
  } finally {
    client.release();
    await pool.end();
  }
}

// Run when called directly
const url = process.env["DATABASE_URL"];
if (!url) {
  process.stderr.write("DATABASE_URL is required\n");
  process.exit(1);
}

runMigrations(url).catch((err) => {
  process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

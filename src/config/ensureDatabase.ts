import { Client } from "pg";

export async function ensureDatabase(databaseName: string, connectionString: string) {
  // Build a connection string that connects to the default "postgres" database
  // We use URL to replace the pathname safely.
  const url = new URL(connectionString);
  // Some connection strings include a leading slash in pathname
  url.pathname = "/postgres";

  const adminConn = url.toString();

  const client = new Client({ connectionString: adminConn });

  try {
    await client.connect();

    const res = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [databaseName]
    );

    if (res.rowCount === 0) {
      // create database with quoted name to allow hyphens
      await client.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`✅ Created database "${databaseName}"`);
    } else {
      console.log(`ℹ️ Database "${databaseName}" already exists`);
    }
  } finally {
    await client.end();
  }
}

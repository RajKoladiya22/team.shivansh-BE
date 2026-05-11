import { validatedEnv } from "../config/validate-env";
import { Pool } from "pg";
const env = validatedEnv;

// console.log("\n\nADMIN_DATABASE_URL in admin-db.ts------->", env.ADMIN_DATABASE_URL, "\n\n ");

export const adminDb = new Pool({
  connectionString: env.ADMIN_DATABASE_URL,
});
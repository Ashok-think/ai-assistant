import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "path";

const dbPath = path.join(process.cwd(), "jarvish.db");

const globalForDb = globalThis as typeof globalThis & {
  __jarvishClient?: ReturnType<typeof createClient>;
};

export const client =
  globalForDb.__jarvishClient ??
  createClient({ url: `file:${dbPath}` });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__jarvishClient = client;
}

export const db = drizzle(client);

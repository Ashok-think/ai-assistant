"use client";
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Cloud configuration is unavailable");
  client ??= createBrowserClient(url, key, {
    cookieOptions: { sameSite: process.env.NODE_ENV === "production" ? "lax" : "none", secure: true },
  });
  return client;
}

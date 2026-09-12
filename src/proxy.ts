import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const cloud = path === "/cloud" || path.startsWith("/cloud/") || path.startsWith("/auth/") || path.startsWith("/api/cloud/");
  // Local executors and single-user SQLite routes must never run on a public Vercel deployment.
  if (process.env.VERCEL === "1" && !cloud) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Local-only endpoint. Use the authenticated cloud workspace." }, { status: 403 });
    return NextResponse.redirect(new URL("/cloud", request.url));
  }
  const headers = new Headers(request.headers);
  headers.set("x-jarvish-cloud", cloud || process.env.VERCEL === "1" ? "1" : "0");
  let response = NextResponse.next({ request: { headers } });
  if (!cloud) return response;
  const noStore = (res: NextResponse) => {
    res.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.cookies.getAll().forEach((cookie) => res.cookies.set(cookie));
    return res;
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return noStore(NextResponse.json({ error: "Cloud configuration is unavailable." }, { status: 503 }));
  const supabase = createServerClient(url, key, {
    cookieOptions: { sameSite: process.env.NODE_ENV === "production" ? "lax" : "none", secure: true },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set("cookie", request.cookies.toString());
        response = NextResponse.next({ request: { headers } });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && (path === "/cloud" || path.startsWith("/cloud/"))) {
    return noStore(NextResponse.redirect(new URL("/auth/login", request.url)));
  }
  return noStore(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|icon|manifest.webmanifest|sw.js|images/|assets/).*)"],
};

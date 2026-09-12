import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEntity, isUUID, validateInput } from "@/lib/cloud/validation";

type Context = { params: Promise<{ entity: string }> };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

async function handle(request: NextRequest, context: Context) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return reply({ error: "Sign in to access cloud data." }, 401);
    const { entity } = await context.params;
    const spec = getEntity(entity);
    if (!spec) return reply({ error: "Unknown entity." }, 404);
    const method = request.method;
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      if (!origin || origin !== request.nextUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Cross-origin write rejected." }, 403);
      if (!spec.fields) return reply({ error: "This entity is read-only until its secure execution workflow is available." }, 403);
    }
    const id = request.nextUrl.searchParams.get("id");
    if (id && !isUUID(id)) return reply({ error: "Invalid record ID." }, 400);
    if (method === "GET") {
      let query = supabase.from(entity).select(spec.columns).eq(spec.owner, user.id).order("created_at", { ascending: false }).limit(100);
      if (id) query = query.eq("id", id);
      const parent = request.nextUrl.searchParams.get("conversation_id");
      if (entity === "messages" && parent) {
        if (!isUUID(parent)) return reply({ error: "Invalid conversation ID." }, 400);
        query = query.eq("conversation_id", parent);
      }
      const { data, error } = await query;
      if (error) { console.error("Cloud read failed", entity, error.code); return reply({ error: "Cloud data could not be loaded." }, 503); }
      return reply({ data });
    }
    if (method === "DELETE") {
      if (!id) return reply({ error: "A record ID is required." }, 400);
      const { data, error } = await supabase.from(entity).delete().eq(spec.owner, user.id).eq("id", id).select("id");
      if (error) return reply({ error: "Record could not be deleted. It may still be referenced." }, 409);
      return data?.length ? reply({ data: data[0] }) : reply({ error: "Record not found." }, 404);
    }
    if (!request.headers.get("content-type")?.includes("application/json")) return reply({ error: "Use application/json." }, 415);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 120000) return reply({ error: "Request is too large." }, 413);
    let fields: Record<string, unknown>;
    try { fields = validateInput(entity, JSON.parse(body), method === "PATCH"); }
    catch (error) { return reply({ error: error instanceof SyntaxError ? "Invalid JSON." : (error as Error).message }, 400); }
    if (method === "PATCH") {
      if (!id) return reply({ error: "A record ID is required." }, 400);
      const { data, error } = await supabase.from(entity).update(fields).eq(spec.owner, user.id).eq("id", id).select(spec.columns);
      if (error) return reply({ error: "Update rejected. Check the record and its relationships." }, 409);
      return data?.length ? reply({ data: data[0] }) : reply({ error: "Record not found." }, 404);
    }
    const record = { ...fields, [spec.owner]: user.id, ...(entity === "messages" ? { role: "user" } : {}), ...(entity === "memories" ? { source: "user" } : {}) };
    const { data, error } = await supabase.from(entity).insert(record).select(spec.columns).single();
    if (error) return reply({ error: "Creation rejected. Check the record and its relationships." }, 409);
    return reply({ data }, 201);
  } catch {
    return reply({ error: "Cloud service is temporarily unavailable." }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

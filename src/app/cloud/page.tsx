import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CloudWorkspace from "@/components/cloud/CloudWorkspace";
export const metadata: Metadata = { title: "Cloud workspace — JARVISH", robots: { index: false, follow: false } };
export default async function CloudPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  return <CloudWorkspace email={user.email ?? "Signed-in account"} userId={user.id} />;
}

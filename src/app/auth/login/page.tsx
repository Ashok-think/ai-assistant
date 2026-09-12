import type { Metadata } from "next";
import AuthForm from "@/components/cloud/AuthForm";
export const metadata: Metadata = { title: "Sign in — JARVISH Cloud", robots: { index: false, follow: false } };
export default async function Login({ searchParams }: { searchParams: Promise<{ confirmation?: string }> }) {
  const params = await searchParams;
  return <div className="px-6"><AuthForm confirmationFailed={params.confirmation === "failed"} /></div>;
}

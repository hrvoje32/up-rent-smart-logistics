import { LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  return <LoginForm nextPath={params.next} configured={isSupabaseConfigured()} />;
}

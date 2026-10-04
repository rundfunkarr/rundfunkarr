import { redirect } from "next/navigation";
import { getAuthConfig, safeReturnTo } from "@/lib/auth";
import { LoginForm } from "@/components/auth/login-form";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const config = await getAuthConfig();
  if (!config?.enabled) redirect("/");
  const params = await searchParams;
  return <LoginForm returnTo={safeReturnTo(params.returnTo)} />;
}

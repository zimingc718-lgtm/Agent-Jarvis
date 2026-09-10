import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";
import { ModelSettings } from "@/components/ModelSettings";
import { getDefaultProviderTemplates } from "@/lib/providers";
import { getStore } from "@/lib/store-singleton";

export default async function ModelSettingsPage() {
  const session = await getServerSession(authOptions);
  const auth = requireUserId(session);
  if (!auth.ok) {
    redirect("/api/auth/signin");
  }

  return (
    <main className="settings-page mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <ModelSettings templates={getDefaultProviderTemplates()} providers={getStore().listProviders(auth.userId)} />
    </main>
  );
}

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
    <main className="settings-page">
      <h1>Settings</h1>
      <ModelSettings templates={getDefaultProviderTemplates()} providers={getStore().listProviders(auth.userId)} />
    </main>
  );
}

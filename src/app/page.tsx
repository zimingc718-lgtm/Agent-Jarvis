import { getServerSession } from "next-auth";
import { AccountDialog } from "@/components/AccountDialog";
import { ConfigWarning } from "@/components/ConfigWarning";
import { FloatingChat, type FloatingMessage } from "@/components/FloatingChat";
import { SettingsDialog } from "@/components/SettingsDialog";
import { authOptions, getGoogleOAuthConfig } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";
import { getDefaultProviderTemplates } from "@/lib/providers";
import { STORAGE_CONFIG_HINT, getStorageConfig } from "@/lib/runtime-config";
import { getStore } from "@/lib/store-singleton";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const auth = requireUserId(session);
  const googleOAuth = getGoogleOAuthConfig();
  const storage = getStorageConfig();
  const templates = getDefaultProviderTemplates();

  // The store refuses to open without JARVIS_SECRET_KEY, and it is only ever
  // touched for a signed-in user — so check the key before touching it, rather
  // than letting a successful login turn into a 500.
  const storeReady = auth.ok && storage.configured;

  const savedProviders = storeReady ? getStore().listProviders(auth.userId) : [];
  const providers = savedProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    defaultModel: provider.defaultModel,
    connected: provider.connected && provider.enabled,
  }));

  let initialConversationId: string | null = null;
  let initialMessages: FloatingMessage[] = [];
  if (storeReady) {
    const [recent] = getStore().listRecentConversations(auth.userId);
    if (recent) {
      initialConversationId = recent.id;
      initialMessages = getStore()
        .listMessages(recent.id)
        .map((message) => ({ id: message.id, role: message.role, content: message.content, status: message.status }));
    }
  }

  return (
    <main className="home">
      <header className="home__bar">
        <h1 className="home__title">Agent-Jarvis</h1>
        <div className="home__actions">
          <SettingsDialog templates={templates} providers={savedProviders} storage={storage} />
          <AccountDialog authenticated={auth.ok} googleOAuth={googleOAuth} />
        </div>
      </header>

      {auth.ok && !storage.configured ? (
        <ConfigWarning title="本地存储未配置" missing={storage.missing} hint={STORAGE_CONFIG_HINT} />
      ) : null}

      {storeReady ? (
        <FloatingChat
          providers={providers}
          initialConversationId={initialConversationId}
          initialMessages={initialMessages}
        />
      ) : !auth.ok ? (
        <p className="home__hint">登录 Agent-Jarvis 后即可开始对话。</p>
      ) : null}
    </main>
  );
}

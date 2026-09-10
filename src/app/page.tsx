import { getServerSession } from "next-auth";
import { AccountDialog } from "@/components/AccountDialog";
import { ConfigWarning } from "@/components/ConfigWarning";
import { CornerMenu } from "@/components/CornerMenu";
import { DisplayScreen } from "@/components/DisplayScreen";
import { FloatingChat, type FloatingMessage } from "@/components/FloatingChat";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SkillList } from "@/components/SkillList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { authOptions, getGoogleOAuthConfig } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";
import { resolveDisplayView } from "@/lib/display";
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
  const hasEnabledProvider = savedProviders.some((provider) => provider.enabled);
  const registeredSkills = storeReady
    ? getStore()
        .listSkills(auth.userId)
        .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }))
    : [];

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
      {/* CR-20260909-display-screen: the home page IS a full-screen display screen;
          the chat and ☰ menu float above it (z-index: base / 20 / 30). */}
      {storeReady ? <DisplayScreen initial={resolveDisplayView()} /> : null}

      <CornerMenu>
        <ThemeToggle />
        <SettingsDialog templates={templates} providers={savedProviders} storage={storage} />
        <AccountDialog authenticated={auth.ok} googleOAuth={googleOAuth} />
        {storeReady ? <SkillList initialSkills={registeredSkills} /> : null}
      </CornerMenu>

      {auth.ok && !storage.configured ? (
        <div className="home__message">
          <ConfigWarning title="本地存储未配置" missing={storage.missing} hint={STORAGE_CONFIG_HINT} />
        </div>
      ) : null}

      {storeReady ? (
        <FloatingChat
          hasEnabledProvider={hasEnabledProvider}
          initialConversationId={initialConversationId}
          initialMessages={initialMessages}
        />
      ) : !auth.ok ? (
        <div className="home__message">
          <h1 className="home__title">Agent-Jarvis</h1>
          <p className="home__hint">登录 Agent-Jarvis 后即可开始对话。</p>
        </div>
      ) : null}
    </main>
  );
}

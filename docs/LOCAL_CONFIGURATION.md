# Local real configuration

Create `.env.local` in the project root for real Google OAuth and model-provider
testing. Do not commit it (`.gitignore` already excludes it).

Verify the result before starting the app:

```powershell
npm run config:check
```

## Required variables

```env
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-long-random-secret
GOOGLE_CLIENT_ID=replace-with-google-oauth-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-oauth-client-secret
JARVIS_SECRET_KEY=replace-with-a-long-random-secret-used-for-provider-secret-encryption
JARVIS_DB_PATH=.data/agent-jarvis.sqlite
# 本地知识库目录：一个条目一个 .md 文件，可直接手工增删（默认 .data/knowledge）
JARVIS_KNOWLEDGE_PATH=.data/knowledge
```

Generate the two secrets with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## Google Cloud OAuth client

- Application type: Web application
- Authorized JavaScript origins: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

`NEXTAUTH_URL` must match the port the app actually runs on and the redirect URI
registered above.

## Four things that cost time if you miss them

1. **All four OAuth variables are required before the sign-in button appears.**
   Missing any of them makes the account dialog show the missing names instead
   of a sign-in link. That is deliberate: the app refuses to fake a Google
   client rather than fail confusingly later.

2. **`JARVIS_SECRET_KEY` is required too, and its absence only shows up after a
   successful login.** It encrypts provider credentials at rest, and the store
   refuses to open without it. Set it in the same pass as the OAuth values;
   otherwise the home page blocks with a named configuration warning (and the
   store-backed APIs answer `503`) as soon as you are signed in.

3. **Next.js reads env files only at startup.** Restart the dev server after
   editing `.env.local` — reloading the page is not enough.

4. **An exported shell variable wins over `.env.local`, even when it is empty.**
   dotenv never overrides a variable that already exists in the environment, so
   `GOOGLE_CLIENT_ID=` in your shell silently shadows a correct file value.
   `npm run config:check` reports this case as `遮蔽` rather than `缺失`.

## Test bypass

`JARVIS_TEST_USER_ID` skips login outside production and is used by
`npm run test:smoke` and `npm run test:e2e`. **Leave it unset when validating
real Google login** — otherwise you cannot tell whether OAuth actually works.
`npm run config:check` warns when it is set.

## Verifying real login (TEST-022)

The automated suites all use the bypass above, so a successful Google sign-in is
a **manual** verification item. After configuring the values, walk:

1. open `/`, open the 账号登录 dialog, click **Sign in with Google**
2. complete Google's consent screen and land back on `/` as signed in
3. open the 配置 dialog, save a provider, run one chat turn
4. sign out and confirm a protected API returns `401` again

Record the outcome in `project/05_evidence/test-results.json` under `TEST-022`
with `verified_by` and `verified_at`. Until then `python tools/governance.py gate g3`
blocks on that item by design.

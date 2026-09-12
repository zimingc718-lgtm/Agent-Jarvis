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

## 本机搜索后端（SearXNG）

`web_search` 需要一个本机 SearXNG。地址没配时该工具**不注册**，模型侧表现为「没有搜索工具」——
这正是 2026-09-11 用户报告的现象（`CR-20260911-web-reading`）。

配置文件 `.data/searxng/settings.yml` 里有两项必须开，缺一 JSON 接口就不可用：

- `search.formats` 必须包含 `json`（SearXNG 默认只出 HTML）
- `server.limiter: false`（默认的 bot limiter 会挡住本机程序化客户端）

启动（仅绑定回环，不对外暴露）：

```powershell
docker run -d --name jarvis-searxng --restart unless-stopped `
  -p 127.0.0.1:8080:8080 `
  -v "<仓库绝对路径>\.data\searxng:/etc/searxng" `
  docker.io/searxng/searxng:latest
```

然后在 ☰ →「搜索设置」填 `http://127.0.0.1:8080`，点「测试连接」应返回「搜索服务连接正常。」。

**不要用公共 SearXNG 实例**：实测 8 个公共实例全部不提供 JSON 接口（返回 HTML 或 403/429）。

## 网页与 PDF 读取的已知边界

`read_url` 现在会按 `content-type` 区分网页与 PDF，并在被拦截时自动改用浏览器重试
（☰ →「搜索设置」可关闭）。仍有两类读不到，**这是站点方的防护，不是配置问题**：

- **Cloudflare / Akamai 的 JS 人机校验**（实测：opencompute.org、iea.org、tesla.com）。
  补全浏览器请求头无效；驱动真实 Chromium（有头和无头都试过）也停在「请稍候…」不动。
  工具会如实报「人机校验未通过」，请改用其它来源，或把正文贴给助手 / 存成文件拖进知识库。
- **扫描件 PDF**（整页是图片，没有文字层）。不做 OCR，工具会明说。

加密 PDF 同样会如实报失败，请先另存为未加密副本。

## 日常怎么跑（推荐：生产构建）

```powershell
npm run build:local     # 约 5 秒
npm run start:local     # 默认 3000 端口
```

产物在独立的 `.next-prod`，不与 `next dev` 抢 `.next`（DEC-009），两者可以同时跑。

**为什么推荐它**：`next dev` 的常驻内存会随热更新次数持续增长，实测由 772 MB 涨到 3.8 GB；内存紧张时它的编译 worker 先被系统杀掉，此时 **GET 路由仍返回 200，而需要按需编译的路由返回 500**，看起来像业务出 bug。2026-09-11 至 12 之间因此发生四次「删不掉 Provider / 优先级不生效」的误判。生产构建实测常驻 103 至 134 MB，相差十几到二十几倍。

**代价**：没有热更新。改完代码必须重新 `npm run build:local`，否则你看到的还是上一次构建的行为。

改代码频繁时仍然用 `npm run dev`，只是别让它连着跑几个小时。

### 判断服务是否还健康

只看首页或 GET 接口会被骗。要打一个**按需编译**的路由。最省事的只读探针：

```powershell
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/knowledge
```

返回 500 就说明编译 worker 已经死了，重启即可。不要用「上移再下移 Provider」这种写操作探针——服务半死时第二步会失败，把顺序留在改坏的状态。

### 生产模式为什么不要求登录

`JARVIS_TEST_USER_ID` 只在非生产生效，生产构建下所有 API 会返回 401。本机单管理员形态改由 `JARVIS_SINGLE_ADMIN_ID` 提供，且**只在 `NEXTAUTH_URL` 为回环地址时生效**——指向真实域名或局域网地址时自动拒绝并回落为 401，免登录模式不会被误开到公网。

两个变量请设成同一个 id，否则 dev 与生产会看到两套不同的 Provider 与会话。`npm run config:check` 会检查这一点并告警。

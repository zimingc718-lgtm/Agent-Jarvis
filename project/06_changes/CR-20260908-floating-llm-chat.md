# CR-20260908-floating-llm-chat

- 级别：L2
- 提出人：用户
- 状态：APPROVED
- 影响需求：REQ-F-001 至 REQ-F-014，REQ-NF-001 至 REQ-NF-004
- 影响模块：MOD-AUTH，MOD-DB，MOD-PROVIDER，MOD-ADAPTER，MOD-CHAT，MOD-CHAT-UI，MOD-SETTINGS-UI
- 影响任务：TASK-001 至 TASK-008
- 影响测试：TEST-001 至 TEST-013
- 当前证据：`project/05_evidence/EV-2026-09-08-provider-api-auth.md`
- 方案选项：Next.js 全栈；React + FastAPI；Vue + FastAPI
- 选择理由：Next.js 全栈能在一个本机项目内完成 Google 登录、API routes、SSE、设置页和悬浮 UI，首版集成成本最低。
- 回滚方式：回退代码和受控说明书到上一基线；恢复上一份 SQLite schema 与配置快照；重新运行治理脚本。
- 验收条件：G1/G2 通过；全部必选测试通过；真实入口冒烟通过；发布清单生成。
- 评审记录：产品、架构、开发、测试、发布角色在对应说明书中完成评审并给出 APPROVED。

- 实施验证证据：project/05_evidence/test-results.json；npm test、npm run build、npm run test:smoke、python -m unittest tests.test_governance -v 均已通过。

- 认证配置修正：移除 Google OAuth 假 client fallback；缺 GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/NEXTAUTH_SECRET/NEXTAUTH_URL 时首页显示配置阻断；真实 Google 登录必须使用 .env.local 配置。

- 人操作流测试：新增 Playwright Chromium E2E，按用户路径执行首页 -> 模型设置 -> 保存本地 provider -> 回首页 -> 发送流式对话 -> 验证最近会话。

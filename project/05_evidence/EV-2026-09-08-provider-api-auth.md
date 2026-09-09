# EV-2026-09-08-provider-api-auth

- 证据 ID：EV-2026-09-08-provider-api-auth
- 来源类型：官方文档
- 采集时间：2026-09-08
- 采集者：Codex
- 支撑对象：REQ-F-008、REQ-F-010、REQ-F-011、REQ-F-012、REQ-NF-003、DEC-003

## OpenAI

- 来源：https://platform.openai.com/docs/quickstart/make-your-first-api-request
- 事实：OpenAI API quickstart 要求创建 API key，并展示 Responses API 的 `stream: true` 用法。
- 来源：https://platform.openai.com/docs/api-reference/backward-compatibility
- 事实：OpenAI API 使用 API keys 认证，API key 需要在服务端安全加载，并通过 HTTP Bearer authentication 提供。

## DeepSeek

- 来源：https://api-docs.deepseek.com/
- 事实：DeepSeek API 提供 OpenAI 兼容调用格式，OpenAI base URL 为 `https://api.deepseek.com`，API key 需要申请。
- 来源：https://api-docs.deepseek.com/api/deepseek-api
- 事实：DeepSeek API 认证方式为 Bearer Auth。

## 结论

第三方模型账号授权框架应支持官方 OAuth Provider，但 OpenAI 与 DeepSeek 首版模型调用按官方文档采用服务端 API Key/Bearer 方式托管。

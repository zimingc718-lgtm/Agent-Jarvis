import { lookup, type Vars } from "./i18n-core";
import type { UiLanguage } from "./language";

/**
 * Server-side text that reaches the interface (REQ-F-350, DEC-470; CR-20260928-server-strings-i18n):
 * API `message` fields, the notices the chat orchestration streams into the transcript, the
 * status a tool step row shows, and the wording of typed domain errors when a route hands them
 * back to the browser. `zh` is the source of keys and, byte for byte, what those places said
 * before this CR; `en` must define exactly the same keys.
 *
 * Not here on purpose: text written into data files, prompts and tool results meant for the
 * model (INPUT-2026-09-27-002 ruling ④), console diagnostics. Never imported by a component —
 * the browser bundle does not carry this table.
 */
export const zhServer = {
  // ---- API routes ----
  "api.effectsInvalid": "未知的 effects 取值：{values}（只接受 read / write / network）。",
  "api.noInsightThisTurn": "本轮未产出洞察。",
  "api.missingId": "缺少 id。",
  "api.unsupportedFileType": "不支持的文件类型。",
  "api.notAdoptedYet": "「{path}」还没有被采纳，按约定审批通过后才能查看。",
  "api.rawHint": "{reason}可以加 &raw=1 查看原始文件。",
  "api.formatSkillStale": "本次未经排版：设置里的排版技能已不存在，请在「本地文档」里重新选择。",
  "api.documentReadFailed": "读取文档失败。",
  "api.pendingNotFound": "待采纳区没有「{name}」。",
  "api.proposalNotFoundOrOrphan": "没有编号为「{id}」的待采纳修改，或它指向的对象已不存在。",
  "api.proposalNotFound": "没有编号为「{id}」的待采纳修改。",
  "api.kindInvalid": "kind 必须是 competitor、authority 或 customer 之一。",
  "api.entitySaveFailed": "实体保存失败。",
  "api.entityNotFound": "没有名为「{name}」的跟踪对象。",
  "api.missingUrl": "缺少 url。",
  "api.missingParamName": "缺少参数名。",
  "api.reservedParam": "「{name}」是对象自身的结构字段，不能当作技术参数。",
  "api.paramStatusInvalid": "status 必须是 unknown、meets 或 unmet 之一。",
  "api.paramNotFound": "对象上没有名为「{name}」的参数。",
  "api.fieldNotUpdatable": "字段「{field}」不可更新。",
  "api.unknownAction": "未知的 action。可用：seen、field、addSource、removeSource、fetch。",
  "api.missingEntityName": "缺少对象名称。",
  "api.missingInsightId": "缺少 insightId。",
  "api.insightNotFound": "找不到这份报告，或它不属于当前用户。",
  "api.archiveFailed": "归档失败。",
  "api.uncategorized": "未分类",
  "api.missingFile": "缺少文件。",
  "api.notTextNote": "「{name}」不是文本笔记（支持 .md / .txt）。",
  "api.fileTooLarge": "「{name}」超过 {kb}KB。",
  "api.knowledgeSaveFailed": "知识保存失败。",
  "api.knowledgeNotFound": "没有名为「{name}」的知识条目。",
  "api.missingEntryName": "缺少条目名称。",
  "api.badJson": "请求体不是合法的 JSON。",
  "api.decideStatusInvalid": "status 只能是 adopted / rejected / pending。",
  "api.authModeUnsupported": "OAuth 与 Unsupported 认证模式在当前版本不可保存，请使用 API Key 或 Local。",
  "api.secretUndecryptableRetest": "已存凭据无法解密，请重新输入 API Key 后再测试。",
  "api.missingPath": "缺少 path。",
  "api.folderAlreadyAdded": "这个文件夹已经加过了。",
  "api.missingArchiveOrSkill": "缺少 archive 或 formatSkill。",
  "api.formatSkillUnknown": "没有这个技能，请先在「技能」里上传并注册。",
  "api.archiveUnusable": "归档目录无法使用。",
  "api.missingLabel": "缺少 label。",
  "api.folderNotFound": "没有名为「{label}」的文档目录。",
  "api.searchUrlMissing": "尚未填写搜索服务地址。",
  "api.skillProposalNotFound": "没有编号为「{id}」的待确认技能提议。",
  "api.zipParseFailed": "压缩包解析失败。",
  "api.noReadableText": "没有可读取的文本文件，未注册。",
  "api.skillNameConflictRetry": "已存在同名技能「{name}」，请重命名后重试。",
  "api.skillRegisterFailed": "技能注册失败。",
  "api.missingSkillName": "缺少技能名称。",
  "api.skillNotFound": "没有名为「{name}」的技能。",
  "api.skillDirOrphaned": "技能已注销，但目录 {dir} 删除失败，可手动清理。",
  "api.newNameInvalid": "新名称不合法。",
  "api.skillNameExists": "已存在名为「{name}」的技能。",
  "api.skillDirEscape": "技能目录越界，已拒绝。",
  "api.skillRenameFailed": "技能目录改名失败，未做任何修改。",
  "guard.storageNotConfigured": "服务端存储未配置：缺少 {missing}。请在 .env.local 中设置后重启服务，参见 docs/LOCAL_CONFIGURATION.md。",

  // ---- chat orchestration (chat.ts) ----
  "turn.providerSecret": "无法读取该 Provider 的凭据，请在模型设置中重新输入 API Key。",
  "turn.noProvider": "没有可用的模型 Provider。请在「模型」中启用一个并通过连接测试。",
  "turn.superseded": "上一轮尚未结束，已先将其中止，再处理这条消息。",
  "turn.droppedOrphans": "已跳过 {count} 条错位的工具结果（上一轮被中止时留下的），按修复后的历史继续。",
  "turn.overflowDroppedAll": "本轮上下文超出预算，已省略全部 {count} 条工具结果的正文以继续。需要其中内容请让我重新读取。",
  "turn.overflowNarrowed": "本轮上下文超出预算，已缩短 {count} 条较早的工具结果（保留最近 {turns} 轮）。需要被略去的部分请让我重新读取。",
  "turn.capabilitySwitch": "「{from}」不支持工具调用，本轮改用「{to}」执行。",
  "turn.failover": "「{from}」未能应答（{why}），本轮改用「{to}」。",
  "turn.toolsUnprobed": "当前模型尚未探测工具调用能力，本轮按普通对话进行。可在「模型」中点「测试」完成探测。",
  "turn.toolsUnsupported": "当前模型不支持工具调用，本轮按普通对话进行。",
  "turn.overflowAfterCompaction": "已压缩早前对话并收窄工具结果，{base}",
  "turn.overflowCompactionFailed": "压缩早前对话未成功，已按原样收窄工具结果，{base}",
  "turn.summaryPrompt":
    "你在压缩一段对话历史，供后续轮次作为背景使用。请写一份简洁的中文摘要，必须保留：已经做出的决定、明确的约束与偏好、专有名词与标识符（文件名、接口名、编号）、以及尚未完成的事项。不要复述寒暄，不要添加原文没有的内容。只输出摘要正文。",

  // ---- tool loop (agent-loop.ts): notices and step-row status ----
  "loop.budgetStop": "本轮工具结果累计约 {tokens} tokens，已超出预算 {limit}，停在这里。已完成的部分保留，可就已有结果继续追问。",
  "loop.narrowed": "本轮工具结果较多，较早几条已省略正文以腾出预算；需要时可以让我重新读取。",
  "loop.continuationsExhausted": "回复已自动续写 {count} 次仍未写完，为免无上限消耗在此停下。可以让我就某一部分单独展开。",
  "loop.outputCapped": "回复因达到模型输出上限而被截断，且本轮预算已用尽，在此停下。可以让我就某一部分单独展开。",
  "loop.turnCeiling": "本轮累计已用约 {tokens} tokens，达到本轮预算上限，不再调用工具，改用已获得的材料作答。",
  "loop.argsTruncated": "参数被输出上限截断，未执行",
  "loop.repeatRefused": "重复失败，已拒绝",
  "loop.unknownTool": "未知工具",
  "loop.aborted": "已中止",
  "loop.failed": "失败：{message}",

  // ---- entities ----
  "entity.invalidName": "非法的实体名称「{name}」",
  "entity.pathEscape": "实体路径越界",
  "entity.tooManySameName": "同名实体过多",
  "entity.unknownKind": "未知的实体类型「{kind}」",
  "entity.missingName": "实体缺少名称，未保存。",
  "entity.tooLarge": "实体正文超过 {kb}KB，未保存。",
  "entity.fieldNotUpdatable": "字段「{field}」不可更新",
  "entity.paramNameEmpty": "参数名不能为空。",
  "entity.tooManyParams": "一个对象最多 {max} 条参数，请先清理。",
  "entity.personNameEmpty": "人员姓名不能为空。",
  "entity.tooManyPeople": "一个对象最多 {max} 条人员，请先清理。",
  "entity.urlInvalid": "不是合法的 URL。",
  "entity.urlScheme": "仅支持 http/https。",
  "entity.urlCredentials": "URL 不得包含用户名或密码。",
  "entity.sourceExists": "该源已存在。",
  "entity.proposalDirEscape": "提议目录越界",
  "entity.tooManyProposals": "待采纳的字段提议过多，请先处理。",
  "entity.snapshotEscape": "快照路径越界",
  "entity.notFound": "没有名为「{name}」的跟踪对象。",
  "entity.sourceNotRegistered": "该链接不是这个对象已登记的采集源。",

  // ---- knowledge ----
  "knowledge.pathEscape": "知识条目路径越界",
  "knowledge.invalidName": "非法的条目名称「{name}」",
  "knowledge.tooManySameName": "同名条目过多",
  "knowledge.empty": "知识内容为空，未保存。",
  "knowledge.tooLarge": "知识内容超过 {kb}KB，未保存。请拆分后再存。",

  // ---- library ----
  "library.noneSelected": "没有指定要裁定的资料。",
  "library.missingItems": "资料库里没有这些条目：{items}。",
  "library.missingItemsMore": "资料库里没有这些条目：{items} 等。",

  // ---- local document folders (validateRoot) ----
  "docs.pathEmpty": "路径为空。",
  "docs.pathNotAbsolute": "请填绝对路径。",
  "docs.pathMissing": "路径不存在，或当前账户没有访问权限。",
  "docs.notFolder": "请指向一个文件夹，而不是单个文件。",

  // ---- insight archive (insight-export.ts) ----
  "archive.noRoots": "尚未配置任何文档目录。请先在 ☰ 菜单「本地文档」中添加一个文件夹，再设置归档目录。",
  "archive.notSet": "尚未设置归档目录。请在「本地文档」里指定一个用于存放报告的文件夹，它必须位于已配置的文档目录之内（当前已配置：{names}）。",
  "archive.notAbsolute": "归档目录请填绝对路径。",
  "archive.parentMissing": "归档目录及其上级目录都不存在，请先创建，或换一个已存在的文件夹。",
  "archive.outsideRoots": "归档目录不在任何已配置的文档目录之内，已拒绝——写入范围不会超出你已经授权的那些文件夹。",
  "archive.tooManySameName": "目录里已经有 {max} 份同名归档（{base}），请先整理一下。",
  "archive.tooLarge": "这份报告转换后有 {kb} KB，超过归档上限 {max} KB。",

  // ---- scheduled sweep ----
  "sweep.intervalRange": "巡检间隔需在 {min}–{max} 分钟之间。",
  "sweep.perRoundRange": "每轮条数需在 1–{max} 之间。",
  "sweep.disabled": "定时巡检未开启。",
  "sweep.noSources": "还没有任何对象配置了采集源。",
  "sweep.nothingDue": "本轮没有到期的采集源。",
  "sweep.runFailed": "采集未执行：{message}",
  "sweep.ranChanged": "采集 {count} 个源，其中 {changed} 个有变化。",
  "sweep.ranUnchanged": "采集 {count} 个源，没有变化。",
  "common.unknownError": "未知错误",
  "api.languageInvalid": "language 只接受 \"zh\" 或 \"en\"。",

  // ---- proactive wake-up ----
  "wake.enabledBoolean": "enabled 必须是布尔值。",
  "wake.intervalRange": "唤醒间隔须是 {min}–{max} 之间的整数分钟。",
  "wake.capRange": "每日 token 上限须是 0–{max} 之间的整数。",
  "wake.disabled": "主动唤醒未开启。",
  "wake.capReached": "今日唤醒 token 已达上限（{cap}），明天再试或在 ☰ 中调高上限。",
  "wake.noProvider": "没有可用的模型 Provider，本次唤醒跳过。",
  "wake.noConversation": "还没有对话可供唤醒参考。",
  "wake.callFailed": "唤醒调用失败：{message}",
  "wake.noticePrefix": "主动提醒：",
  "wake.instructions":
    "这是一次空闲唤醒，不是用户提问。请只根据下面截取的最近对话判断：是否有一件值得现在主动提醒用户的事——未完成的事项、明显遗漏的下一步、或对方说过要回头处理的点。有就用一两句中文直接说，不要寒暄、不要复述对话。没有就只回复 NOOP。",
  "wake.transcriptHeader": "最近对话（截取）：",
  "wake.transcriptEmpty": "（无）",

  // ---- zip intake ----
  "zip.archiveTooLarge": "压缩包超过 {limit} 上限。",
  "zip.tooSmall": "不是有效的 zip 压缩包（文件过小）。",
  "zip.zip64": "不支持 zip64 格式的压缩包。",
  "zip.centralDirOutOfRange": "zip 中央目录越界，压缩包可能已损坏。",
  "zip.tooManyEntries": "压缩包条目数超过 {max} 上限。",
  "zip.centralDirCorrupt": "zip 中央目录记录损坏。",
  "zip.encrypted": "不支持加密的 zip 压缩包。",
  "zip.unsafeBackslash": "压缩包内路径不安全（反斜杠分隔符）：{name}",
  "zip.unsafeDrive": "压缩包内路径不安全（盘符前缀）：{name}",
  "zip.unsafeAbsolute": "压缩包内路径不安全（绝对路径）：{name}",
  "zip.unsafeParent": "压缩包内路径不安全（上级目录引用）：{name}",
  "zip.entryTooLarge": "压缩包内单个文件超过 {limit} 上限：{name}",
  "zip.totalTooLarge": "压缩包解压后总大小超过 {limit} 上限。",
  "zip.ratioTooHigh": "压缩包解压比超过 {ratio}:1 上限。",
  "zip.localHeaderCorrupt": "zip 本地文件头损坏：{name}",
  "zip.inflateFailed": "zip 条目解压失败：{name}",
  "zip.inflateOversize": "zip 条目解压后大于声明大小：{name}",
  "zip.noEocd": "不是有效的 zip 压缩包（找不到目录结尾记录）。",
  "zip.dataOutOfRange": "zip 数据越界，压缩包可能已截断。",

  // ---- skill proposals ----
  "skillProposal.notFound": "没有编号为「{id}」的待确认技能提议，或它已被处理。",
  "skillProposal.nameConflict": "已存在同名技能「{name}」，未注册。请先在 ☰ →「技能」里删除/改名旧的那个，再采纳。",
  "skillProposal.registerFailed": "注册技能失败，未写入。",

  // ---- markitdown conversion ----
  "markitdown.pythonMissing": "转换服务不可用（Python 运行时未就绪）。",
  "markitdown.timeout": "文档转换超时，文件可能过大或过于复杂。",
  "markitdown.empty": "转换结果为空——这份文件可能没有可提取的文字层。",
  "markitdown.failed": "文档转换失败。",

  // ---- document layout by skill ----
  "format.noProvider": "本次未经排版：当前没有可用的模型 Provider。",
  "format.skillEmpty": "本次未经排版：排版技能「{name}」的 SKILL.md 为空或不可读。",
  "format.allFailed": "本次未经排版：模型对每一段的输出都不可用，已按原样显示。",
  "format.partial": "已按排版技能「{name}」整理，其中 {kept} 段因模型输出缩水而保留原文（页内有标注）。",
} as const satisfies Record<string, string>;

export type ServerMessageKey = keyof typeof zhServer;

export const enServer = {
  // ---- API routes ----
  "api.effectsInvalid": "Unknown effects value(s): {values} (only read / write / network are accepted).",
  "api.noInsightThisTurn": "No insight was produced this turn.",
  "api.missingId": "Missing id.",
  "api.unsupportedFileType": "Unsupported file type.",
  "api.notAdoptedYet": "“{path}” has not been adopted yet; by the rules it can be viewed only after approval.",
  "api.rawHint": "{reason} Add &raw=1 to view the original file.",
  "api.formatSkillStale": "Not laid out this time: the layout skill in settings no longer exists — pick another under “Local documents”.",
  "api.documentReadFailed": "Could not read the document.",
  "api.pendingNotFound": "“{name}” is not in the review queue.",
  "api.proposalNotFoundOrOrphan": "No pending change with id “{id}”, or the entity it points to no longer exists.",
  "api.proposalNotFound": "No pending change with id “{id}”.",
  "api.kindInvalid": "kind must be one of competitor, authority or customer.",
  "api.entitySaveFailed": "Could not save the entity.",
  "api.entityNotFound": "No tracked entity named “{name}”.",
  "api.missingUrl": "Missing url.",
  "api.missingParamName": "Missing parameter name.",
  "api.reservedParam": "“{name}” is a structural field of the entity and cannot be used as a technical parameter.",
  "api.paramStatusInvalid": "status must be one of unknown, meets or unmet.",
  "api.paramNotFound": "The entity has no parameter named “{name}”.",
  "api.fieldNotUpdatable": "Field “{field}” cannot be updated.",
  "api.unknownAction": "Unknown action. Available: seen, field, addSource, removeSource, fetch.",
  "api.missingEntityName": "Missing entity name.",
  "api.missingInsightId": "Missing insightId.",
  "api.insightNotFound": "This report was not found, or it does not belong to the current user.",
  "api.archiveFailed": "Archive failed.",
  "api.uncategorized": "Uncategorized",
  "api.missingFile": "Missing file.",
  "api.notTextNote": "“{name}” is not a text note (.md / .txt are supported).",
  "api.fileTooLarge": "“{name}” exceeds {kb}KB.",
  "api.knowledgeSaveFailed": "Could not save the knowledge entry.",
  "api.knowledgeNotFound": "No knowledge entry named “{name}”.",
  "api.missingEntryName": "Missing entry name.",
  "api.badJson": "The request body is not valid JSON.",
  "api.decideStatusInvalid": "status must be adopted, rejected or pending.",
  "api.authModeUnsupported": "OAuth and Unsupported auth modes cannot be saved in this version; use API Key or Local.",
  "api.secretUndecryptableRetest": "The stored credential cannot be decrypted; re-enter the API key and test again.",
  "api.missingPath": "Missing path.",
  "api.folderAlreadyAdded": "This folder has already been added.",
  "api.missingArchiveOrSkill": "Missing archive or formatSkill.",
  "api.formatSkillUnknown": "No such skill; upload and register it under “Skills” first.",
  "api.archiveUnusable": "The archive folder cannot be used.",
  "api.missingLabel": "Missing label.",
  "api.folderNotFound": "No document folder named “{label}”.",
  "api.searchUrlMissing": "The search service URL has not been filled in.",
  "api.skillProposalNotFound": "No pending skill proposal with id “{id}”.",
  "api.zipParseFailed": "Could not parse the zip archive.",
  "api.noReadableText": "No readable text files; nothing was registered.",
  "api.skillNameConflictRetry": "A skill named “{name}” already exists; rename and try again.",
  "api.skillRegisterFailed": "Skill registration failed.",
  "api.missingSkillName": "Missing skill name.",
  "api.skillNotFound": "No skill named “{name}”.",
  "api.skillDirOrphaned": "The skill was unregistered, but its folder {dir} could not be deleted; you can remove it by hand.",
  "api.newNameInvalid": "The new name is not valid.",
  "api.skillNameExists": "A skill named “{name}” already exists.",
  "api.skillDirEscape": "The skill folder escapes its root; refused.",
  "api.skillRenameFailed": "Renaming the skill folder failed; nothing was changed.",
  "guard.storageNotConfigured":
    "Server storage is not configured: missing {missing}. Set it in .env.local and restart the service; see docs/LOCAL_CONFIGURATION.md.",

  // ---- chat orchestration (chat.ts) ----
  "turn.providerSecret": "The provider's credential cannot be read; re-enter the API key in model settings.",
  "turn.noProvider": "No model provider is available. Enable one under “Models” and pass the connection test.",
  "turn.superseded": "The previous turn had not finished; it was stopped before handling this message.",
  "turn.droppedOrphans": "Skipped {count} misplaced tool results (left behind when the previous turn was stopped) and continued with the repaired history.",
  "turn.overflowDroppedAll": "This turn's context exceeded the budget; the bodies of all {count} tool results were omitted to continue. Ask me to read again if you need them.",
  "turn.overflowNarrowed": "This turn's context exceeded the budget; {count} earlier tool results were shortened (the last {turns} turns kept). Ask me to read again for what was left out.",
  "turn.capabilitySwitch": "“{from}” does not support tool calls; this turn ran on “{to}” instead.",
  "turn.failover": "“{from}” did not answer ({why}); this turn used “{to}” instead.",
  "turn.toolsUnprobed": "The current model's tool-calling ability has not been probed; this turn runs as plain chat. Click “Test” under “Models” to probe it.",
  "turn.toolsUnsupported": "The current model does not support tool calls; this turn runs as plain chat.",
  "turn.overflowAfterCompaction": "Earlier conversation was compacted and tool results narrowed; {base}",
  "turn.overflowCompactionFailed": "Compacting the earlier conversation failed; tool results were narrowed as they were; {base}",
  "turn.summaryPrompt":
    "You are compacting a conversation history for later turns to use as background. Write a concise summary in English that keeps: decisions already made, explicit constraints and preferences, proper nouns and identifiers (file names, API names, ids), and unfinished items. Do not repeat pleasantries or add anything not in the original. Output only the summary text.",

  // ---- tool loop (agent-loop.ts): notices and step-row status ----
  "loop.budgetStop": "Tool results this turn total about {tokens} tokens, over the {limit} budget; stopping here. What was completed is kept — you can ask about the results so far.",
  "loop.narrowed": "Many tool results this turn; the bodies of the earlier ones were omitted to free budget. Ask me to read again if needed.",
  "loop.continuationsExhausted": "The reply was auto-continued {count} times and is still unfinished; stopping to avoid unbounded spend. Ask me to expand one part separately.",
  "loop.outputCapped": "The reply was cut off at the model's output limit and this turn's budget is spent; stopping here. Ask me to expand one part separately.",
  "loop.turnCeiling": "About {tokens} tokens used this turn, reaching the turn budget; no more tool calls — answering from the material already gathered.",
  "loop.argsTruncated": "arguments cut off at the output limit; not run",
  "loop.repeatRefused": "repeated failure; refused",
  "loop.unknownTool": "unknown tool",
  "loop.aborted": "aborted",
  "loop.failed": "failed: {message}",

  // ---- entities ----
  "entity.invalidName": "Invalid entity name “{name}”",
  "entity.pathEscape": "Entity path escapes its root",
  "entity.tooManySameName": "Too many entities with the same name",
  "entity.unknownKind": "Unknown entity kind “{kind}”",
  "entity.missingName": "The entity has no name; not saved.",
  "entity.tooLarge": "The entity body exceeds {kb}KB; not saved.",
  "entity.fieldNotUpdatable": "Field “{field}” cannot be updated",
  "entity.paramNameEmpty": "The parameter name cannot be empty.",
  "entity.tooManyParams": "An entity can hold at most {max} parameters; remove some first.",
  "entity.personNameEmpty": "The person's name cannot be empty.",
  "entity.tooManyPeople": "An entity can hold at most {max} people; remove some first.",
  "entity.urlInvalid": "Not a valid URL.",
  "entity.urlScheme": "Only http/https are supported.",
  "entity.urlCredentials": "The URL must not contain a username or password.",
  "entity.sourceExists": "This source already exists.",
  "entity.proposalDirEscape": "Proposal path escapes its root",
  "entity.tooManyProposals": "Too many pending field proposals; decide on some first.",
  "entity.snapshotEscape": "Snapshot path escapes its root",
  "entity.notFound": "No tracked entity named “{name}”.",
  "entity.sourceNotRegistered": "This link is not a registered source of the entity.",

  // ---- knowledge ----
  "knowledge.pathEscape": "Knowledge entry path escapes its root",
  "knowledge.invalidName": "Invalid entry name “{name}”",
  "knowledge.tooManySameName": "Too many entries with the same name",
  "knowledge.empty": "The knowledge content is empty; not saved.",
  "knowledge.tooLarge": "The knowledge content exceeds {kb}KB; not saved. Split it and save again.",

  // ---- library ----
  "library.noneSelected": "No material was specified to decide on.",
  "library.missingItems": "These items are not in the library: {items}.",
  "library.missingItemsMore": "These items are not in the library: {items} and others.",

  // ---- local document folders (validateRoot) ----
  "docs.pathEmpty": "The path is empty.",
  "docs.pathNotAbsolute": "Enter an absolute path.",
  "docs.pathMissing": "The path does not exist, or the current account cannot access it.",
  "docs.notFolder": "Point to a folder, not a single file.",

  // ---- insight archive (insight-export.ts) ----
  "archive.noRoots": "No document folders are configured yet. Add a folder under ☰ → “Local documents” first, then set the archive folder.",
  "archive.notSet":
    "No archive folder is set. Under “Local documents”, choose a folder for reports; it must be inside one of the configured document folders (currently configured: {names}).",
  "archive.notAbsolute": "Enter an absolute path for the archive folder.",
  "archive.parentMissing": "Neither the archive folder nor its parent exists; create it first, or choose an existing folder.",
  "archive.outsideRoots": "The archive folder is outside every configured document folder; refused — writes never leave the folders you have authorized.",
  "archive.tooManySameName": "The folder already holds {max} archives with this name ({base}); tidy up first.",
  "archive.tooLarge": "This report is {kb} KB after conversion, over the {max} KB archive limit.",

  // ---- scheduled sweep ----
  "sweep.intervalRange": "The sweep interval must be between {min} and {max} minutes.",
  "sweep.perRoundRange": "Sources per round must be between 1 and {max}.",
  "sweep.disabled": "Scheduled sweep is off.",
  "sweep.noSources": "No entity has a source configured yet.",
  "sweep.nothingDue": "No source was due this round.",
  "sweep.runFailed": "Collection did not run: {message}",
  "sweep.ranChanged": "Collected {count} sources; {changed} changed.",
  "sweep.ranUnchanged": "Collected {count} sources; no changes.",
  "common.unknownError": "unknown error",
  "api.languageInvalid": "language accepts only \"zh\" or \"en\".",

  // ---- proactive wake-up ----
  "wake.enabledBoolean": "enabled must be a boolean.",
  "wake.intervalRange": "The wake-up interval must be a whole number of minutes between {min} and {max}.",
  "wake.capRange": "The daily token cap must be a whole number between 0 and {max}.",
  "wake.disabled": "Proactive wake-up is off.",
  "wake.capReached": "Today's wake-up token cap ({cap}) is reached; try tomorrow or raise the cap under ☰.",
  "wake.noProvider": "No model provider is available; this wake-up was skipped.",
  "wake.noConversation": "There is no conversation yet for the wake-up to look at.",
  "wake.callFailed": "The wake-up call failed: {message}",
  "wake.noticePrefix": "Reminder: ",
  "wake.instructions":
    "This is an idle wake-up, not a user question. Judge only from the recent conversation excerpt below whether there is one thing worth proactively reminding the user about now — an unfinished item, an obviously missed next step, or something they said they would come back to. If so, say it directly in one or two English sentences, no pleasantries, no recap of the conversation. If not, reply only NOOP.",
  "wake.transcriptHeader": "Recent conversation (excerpt):",
  "wake.transcriptEmpty": "(none)",

  // ---- zip intake ----
  "zip.archiveTooLarge": "The archive exceeds the {limit} limit.",
  "zip.tooSmall": "Not a valid zip archive (file too small).",
  "zip.zip64": "zip64 archives are not supported.",
  "zip.centralDirOutOfRange": "The zip central directory is out of range; the archive may be corrupt.",
  "zip.tooManyEntries": "The archive has more than {max} entries.",
  "zip.centralDirCorrupt": "A zip central directory record is corrupt.",
  "zip.encrypted": "Encrypted zip archives are not supported.",
  "zip.unsafeBackslash": "Unsafe path inside the archive (backslash separator): {name}",
  "zip.unsafeDrive": "Unsafe path inside the archive (drive letter prefix): {name}",
  "zip.unsafeAbsolute": "Unsafe path inside the archive (absolute path): {name}",
  "zip.unsafeParent": "Unsafe path inside the archive (parent directory reference): {name}",
  "zip.entryTooLarge": "A file inside the archive exceeds the {limit} limit: {name}",
  "zip.totalTooLarge": "The archive's total uncompressed size exceeds the {limit} limit.",
  "zip.ratioTooHigh": "The archive's compression ratio exceeds the {ratio}:1 limit.",
  "zip.localHeaderCorrupt": "A zip local file header is corrupt: {name}",
  "zip.inflateFailed": "Could not decompress a zip entry: {name}",
  "zip.inflateOversize": "A zip entry decompressed larger than declared: {name}",
  "zip.noEocd": "Not a valid zip archive (no end-of-central-directory record).",
  "zip.dataOutOfRange": "zip data is out of range; the archive may be truncated.",

  // ---- skill proposals ----
  "skillProposal.notFound": "No pending skill proposal with id “{id}”, or it has already been handled.",
  "skillProposal.nameConflict": "A skill named “{name}” already exists; not registered. Delete or rename the old one under ☰ → “Skills”, then adopt again.",
  "skillProposal.registerFailed": "Registering the skill failed; nothing was written.",

  // ---- markitdown conversion ----
  "markitdown.pythonMissing": "The conversion service is unavailable (Python runtime not ready).",
  "markitdown.timeout": "Document conversion timed out; the file may be too large or too complex.",
  "markitdown.empty": "The conversion produced nothing — this file may have no extractable text layer.",
  "markitdown.failed": "Document conversion failed.",

  // ---- document layout by skill ----
  "format.noProvider": "Not laid out this time: no model provider is available.",
  "format.skillEmpty": "Not laid out this time: the SKILL.md of layout skill “{name}” is empty or unreadable.",
  "format.allFailed": "Not laid out this time: the model's output was unusable for every section; shown as is.",
  "format.partial": "Laid out with skill “{name}”; {kept} sections kept their original text because the model's output shrank (marked in the page).",
} as const satisfies Record<ServerMessageKey, string>;

export const SERVER_MESSAGES: Record<UiLanguage, Record<ServerMessageKey, string>> = { zh: zhServer, en: enServer };

export type ServerTranslate = (key: ServerMessageKey, vars?: Vars) => string;

export function tServer(language: UiLanguage, key: ServerMessageKey, vars?: Vars): string {
  return lookup(SERVER_MESSAGES, language, key, vars);
}

/** `tServer` with the language bound: what a route or `runChatTurn` hands down for the rest of the request. */
export function serverTranslator(language: UiLanguage): ServerTranslate {
  return (key, vars) => tServer(language, key, vars);
}

/** The Chinese wording — what a typed error carries as `message`, and what tool results keep saying. */
export function zhMessage(key: ServerMessageKey, vars?: Vars): string {
  return tServer("zh", key, vars);
}

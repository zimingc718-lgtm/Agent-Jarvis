# CR-20260908-ui-standard-process

- 级别: L2
- 提出人: user
- 状态: CLOSED
- 评审模型: pre-R1234（旧 G0/G1/G2/G3/G3.5/G4；CR-20260909-consensus-review-gates 起改为 R1–R4 + G3/G3.5/G4，不追溯本 CR）
- 影响需求: 不新增产品功能需求；仅影响 UI 开发治理基线。
- 影响模块: tools/governance.py, docs/UI_STANDARD.md, docs/AI_STANDARD.md, docs/WORKFLOW.md, docs/CONTROLS.md, AGENTS.md, package.json
- 影响任务: 新增可执行 UI 规范检查，不创建业务实现任务。
- 影响测试: tests/test_governance.py 新增 UI 规范缺失、规范不完整、脚本缺失和通过路径测试。
- 当前证据: python -m unittest tests.test_governance -v PASS；python tools/governance.py ui PASS。
- 方案选项: A. 只写文档；B. 文档加可执行治理脚本；C. 直接进入 UI 功能扩展。
- 选择理由: 选择 B，因为用户要求纳入流程并真正管控，同时 AGENTS.md 要求产品功能未确认前不能扩展业务实现。
- 回滚方式: 删除 docs/UI_STANDARD.md，移除 governance.py 的 ui 命令和 verify 接入，移除 package.json 的 governance:ui 脚本，撤销三份治理文档追加章节和本变更记录后重新运行治理验证。
- 验收条件: `python tools/governance.py ui` 能阻断缺失 UI 规范、缺失 UI 测试脚本和缺失真实入口覆盖的情况；`python tools/governance.py verify` 纳入 UI 控制检查。
- 评审记录: 产品 owner 角色确认不新增产品功能；架构角色确认 UI 规范作为治理基线接入；测试角色确认新增治理单测覆盖失败和通过路径。

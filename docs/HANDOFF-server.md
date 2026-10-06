# 交接入口 · 服务器端会话

> **主文档已升级为 [HANDOFF.md](HANDOFF.md)（架构与协作交接总文档）**——先读它。
>
> 你是服务器端的 AI 会话。最短路径：
> 1. `docs/HANDOFF.md` —— 项目全貌、分工、咬合点（§4.2 特征函数×RAG 同构 schema 必读）
> 2. `miniprogram/PROTOCOL.md` —— 契约圣经（§0 架构总纲、端点表、Step schema、追问类型表）
> 3. `server/index.js` —— 你的战场：把桩换成真实现
>
> 铁规：产出落在既有契约上；改字段先改 PROTOCOL.md 并同步 mock.js 与 server/index.js 双实现；Key 只在后端；桩兜底不断链；凭据找袁博伦单独要，不进文档。

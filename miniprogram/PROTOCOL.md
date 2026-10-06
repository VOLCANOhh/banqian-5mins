# 班前五分钟 · 前后端协议与前端交接文档

> 读者：后端（马知远，orchestrator）、页面填充（同学 C）、联调（全体）、特征函数主线（另一个对话）
> 原则：**后端是导演，前端是渲染器。** 说什么、语气语速、何时提问、答完是否强调、何时结束——全部由后端 JSON 决定；前端不含业务逻辑。

## 0. 架构总纲：确定性层 × 模糊性层

本系统的根本原则：**函数做确定性的事，AI 做模糊性的事。** 内容不存在于系统中，直到 AI 把它写出来。

```
            ┌──────── 确定性层（函数，可解释可复现）────────┐
  工序输入 → │ SM-2 调度 · 复训逾期扫描 · 看板统计 · 降级开关 │ → 推送时机/对象
            └─────────────────────────────────────────────────┘
            ┌──────── 模糊性层（LLM，不可替代）───────────────┐
  规范库 ──→ │ 特征提取（新规范文件入库即理解）                 │
  学习档案 → │ 剧本生成（千人千面，管理员一推送即现写）        │ → 今日内容
  答题语音 → │ 语义判分 · 追问式对答 · 行为诊断                │ → 新证据
            └─────────────────────────────────────────────────┘
```

**三条铁律：**

1. **内容现做**：系统不存预制培训内容。规范库是原料、学习档案是证据，每日剧本由编排器**在管理员推送时即刻生成**（推送即生成，非每人实时——成本可控），推送后工人扫码即播。这同时就是"弱网优先"的落点：推送时剧本已随任务存好，断网可播。
2. **trace 可审计**：每份剧本附六角色 trace（工序解析/规范检索/学情诊断/内容生成/考评/复训调度）——引用了哪条规范、哪位工人的哪次错题，全部留痕。评审看"AI 协同"看这条链，排障也看它。
3. **降级不断链**：LLM 失败 → 回退最近一次成功剧本 → 再退预生成池；判分失败 → `verdict=unknown` 记为待人工复核，流程不中断。


## 1. 运行时模型

```
打开小程序 → POST /api/session/today → 拿到「剧本」steps[]
前端按序执行 steps（一个队列）：
  say   → 文本切成视觉行 → 歌词式滚到正中 → TTS 朗读（WechatSI 插件）→ onEnded 推进
          （插件未添加时降级：hold_ms/字数估时推进）
  ask   → 滚出题目 + TTS 念题 → 念完自动开录 → 插件本地识别出文字 → POST /api/answer
          → 返回 verdict + next_steps[] → 前端把 next_steps 插回队列继续走
  朗读期任意时刻 → 工人点「没听懂?」/ 说"不懂" → 打断 → 录问题 → POST /api/ask
          → 返回 steps[] + replay_current + drop_rest → 拼接语义见 §11
  show  → 只滚字不"读"（预留）
  action→ 本地执行（暂停/字号/音量…，预留）
队列走完 → POST /api/session/finish → result 页展示成绩
```

动态剧本：后端通过 `next_steps`（答题后）和 `/api/ask` 响应（工人主动问）两条通道随时改写队列。前端只 splice，不理解原因——**问什么、要不要追问、怎么打分、答完是否强调，全部后端决定**。

## 2. 端点

全部 `POST` + JSON（文件上传除外）。`API_BASE` 在 `config.js`。

| 端点 | 请求 | 响应 |
|------|------|------|
| `/api/me` | `{ dev_id?, code? }`（code=wx.login 的 → jscode2session 换真 openid；换不出时 dev_id 降级） | `{ openid, role: 'worker'\|'admin', worker?, need_bind? }` |
| `/api/workers` | `{}` | `{ workers: Worker[] }` |
| `/api/session/today` | `{ worker_id }` | `{ session_id, worker, task_text, steps: Step[] }` |
| `/api/answer` | `{ session_id, step_id, answer_text }` | `{ verdict, next_steps: Step[] }` |
| `/api/ask` | `{ session_id, step_id, question }`（step_id=被打断的步） | `{ steps: Step[], replay_current?, drop_rest? }` 语义见 §11 |
| `/api/session/finish` | `{ session_id, events? }` | `{ score, wrong_items[], mastery_update, next_review_date, received_events, trace[] }` |
| `/api/asr` | **wav 裸字节**（POST `Content-Type: application/octet-stream`，16k 单声道 ≤30s；身份走 `X-Dev-Id` header） | `{ text, dialect }`——后端按 openid→worker.dialect 选方言 appkey 调阿里一句话识别 |
| `/api/command` | `{ text }` 或 wav 裸字节（同 `/api/asr` 上传格式） | `{ action, direction?, value?, echo? }`；音频版后端先转文字再匹配，指令统一走普通话 appkey |
| `/api/tts` | `{ text }` | `{ audio_url: '/tts/x.mp3' }`（阿里合成，xiaoyun 音色 mp3；编排器生成剧本时预合成塞进 `say.audio_url`） |
| `/api/weather` | `{ lat, lng }`（wgs84，小程序 `wx.getLocation` 取得） | `{ ok, lat, lng, weather }`——服务端代理和风格点实时天气（`QWEATHER_KEY`/`QWEATHER_HOST` 只在后端；未配 Key 或调用失败一律桩兜底 `weather.source='stub'`，不断链）。公开端点不鉴权，服务端按 ~1km 网格缓存 30min |

`/api/weather` 响应的 `weather` 对象（工作环境信息快照）：

```jsonc
{ "temp": "26",            // 温度 °C
  "feels_like": "27",      // 体感温度 °C
  "text": "多云",           // 天气现象（晴/多云/小雨/雷阵雨…）
  "wind_dir": "东南风",      // 风向
  "wind_scale": "3",       // 风力等级（级）
  "wind_speed": "12",      // 风速 km/h
  "humidity": "55",        // 相对湿度 %
  "precip": "0.0",         // 当前降水量 mm
  "pressure": "1008",      // 气压 hPa
  "vis": "25",             // 能见度 km
  "obs_time": "2026-10-06T06:30+08:00",   // 观测时间
  "source": "qweather|stub",              // 数据源；stub=桩兜底演示数据
  "risk_level": "normal|warn|high",       // 作业风险档位（确定性层推导，前端据此给卡片变色）
  "risk_hints": [ { "level": "warn|high", "text": "6级大风：停止露天高处作业与起重吊装（六级风条款）" } ] }
```

- `risk_hints` 是**确定性层**规则推导（≥6 级风停止高处/吊装、5 级风加强防护、雷电停止露天作业、雨雪防滑防电、≥35°C 高温、≤5°C 低温、能见度 <1km 吊装加强指挥）——函数干确定性的事，不让 LLM 推。
- 天气的归宿：pushEdit 推送时把 `{ lat, lng, weather }` 整体作为 `env` 随 `/api/tasks` 上送存档，作为①工序解析的「工作环境信息」输入（对接 HANDOFF §2.3 预生成管线；此前"天气只能从 task_text 抠"的缺口由此关闭）。

## 3. Step 剧本（核心数据结构）

```jsonc
{ "id": "s1",            // 步 id，answer 回传要用
  "type": "say|ask|show|action",

  // say / ask / show 通用
  "text": "朗读或显示的文字",
  "voice": {             // 可选，TTS 参数（前端原样存，接通后用）
    "speed": 0.95,       // 语速倍率
    "tone": "steady"     // 语气，后端自定义词表
  },
  "audio_url": "https://...",  // 可选，预生成音频；有则播音频而不是定时
  "hold_ms": 3000,       // 可选，本步停留毫秒；缺省前端按字数估算

  // ask 专属
  "listen": { "timeout_ms": 30000 },  // 答题录音上限

  // action 专属
  "op": "pause|set_font|set_volume|repeat|next",
  "direction": "up|down", "value": "…" }
```

**约定：**
- `say` 步期间前端开启指令监听（见 §5）；`ask/show/action` 步自动关闭。
- 题目也可能要多行——前端切行逻辑对一切 `text` 生效，后端不用管排版。
- 想让用户复述/强调，不要发明新 type——answer 返回 `next_steps` 里再塞 `say`/`ask` 即可。
- 重问步的 id 建议后缀 `-re`，防止无限重问（前端不限制，靠后端节制）。

## 4. /api/answer 响应

```jsonc
{ "verdict": "correct|partial|wrong|unknown",
  "next_steps": [ /* Step[]，可空 */ ],
  "mastery_delta": { "连墙件设置要求": +0.2 }   // 可选，前端不读，透传到 finish
}
```

**追问类型表（升级2：考评从"阅卷机"变"考官"；2026-10-05 按定稿回写 wrong/unknown 行）**——`next_steps` 的注入模式：

| verdict | 注入步骤 | 语义 |
|---------|----------|------|
| correct | `[say(表扬), ask(情景变式追问, id 后缀 -var)]` | 测迁移不测背诵："如果你发现连墙件被人拆了，应该怎么办？" |
| partial（模糊） | `[say(点拨模糊点, id 后缀 -hint), ask(完整重答, 后缀 -re)]` | 答到一半：针对缺的那一块钻一层 |
| wrong | `[say(再想想引导, id 后缀 -dig), ask(换问法重试, 后缀 -re)]` | **先挖一层**：不立即给答案，让他再试一次 |
| 二次错（`-re` 步仍 wrong） | `[say(正确答案强调, id 后缀 -fix)]` | 只给答案，不加因果钩子，不再追问，直接收束 |
| unknown（没听清/无关答） | `[say(不勉强先继续, id 后缀 -skip)]` | 不追问、不冤枉（宁 unknown 不 wrong），记待人工复核 |
| 追问步答完 | `[say(收束语, id 后缀 -end)]` | `-re`/`-var` 步答完即止，防无限追问 |

- `-re` 步答对记 **assisted_correct（扶助对）**：学情内部档位，权重介于 correct 与 partial 之间（防"被喂答案后的答对"污染遗忘曲线）；契约 `verdict` 枚举不变（仍返回 `correct`），仅服务端学情记录与 finish 计分区分（扶助对按 80 计，独立答对 100、模糊 60、答错 20）。
- 追问深度 ≤2 层不变（id 后缀计数；前端只 splice，不理解追问语义，深度与终止策略全由后端决定）。

## 5. 语音指令通道（commander）

朗读（say 步）期间指令监听开启。主路径：WechatSI 插件流式识别，`onRecognize` 中间结果 1.5s 节流后以 `{text}` POST `/api/command`；降级路径（无插件）：循环录 8 秒一片音频上传。响应均为一个动作 JSON：

```jsonc
{ "action": "pause|resume|set_font|set_volume|repeat|ask|next|none",
  "direction": "up|down",   // set_font / set_volume 用
  "value":    "…",          // 也可直接给值
  "echo":     "识别出的原文" }
```

| action | 前端行为 |
|--------|----------|
| pause / resume | 暂停/继续（暂停时监听不中断，"继续"才能被听见） |
| set_font | 字号三档循环 l→xl→xxl，只大不小 |
| set_volume | globalData.volume ±0.2（0.2–2.0），实时作用于 TTS 播放 |
| repeat | 当前行重滚+音频 seek(0) 重读 |
| ask | 打断提问 → 进入 §11 流程（"不懂/什么意思/为啥"触发） |
| next | 跳过当前步 |
| none | 忽略（大部分分片都是 none：环境音、正常说话、TTS 回声） |

**后端侧预期**：分片音频 → ASR（阿里方言模型）→ 小模型意图分类 → 动作 JSON。80% 以上分片应返回 `none`，别把工地说笑声误判成指令。

**已知限制（写进风险表）：**
- TTS 外放会被麦克风录回（回声）→ 指令分类器要抗"自己说话"；或 PTT 方案兜底（按住才听）。
- `recorderManager` 无 VAD，"说完了自动停"做不到；当前 30s 封顶+手动停。要真语音助手得换阿里实时识别（WebSocket 流式带断句）。
- 指令监听只在 say 步开；答题录音独占麦克风。

## 6. 前端文件地图

| 文件 | 职责 |
|------|------|
| `pages/training/` | 工人端唯一交互页：剧本执行器 + 歌词字幕 + 三态大圆钮 + 扫码入口路由 |
| `pages/result/` | 成绩页，读 `finish` 响应 |
| `pages/bind/` | 工人未绑定落点：亮身份码给班组长扫 + 扫个人绑定码 |
| `pages/admin/admin` | 管理端首页：今日看板（任务卡/统计色块/工人完成情况） |
| `pages/admin/push` | 推送学习内容（日期 + 工作内容 + 备注 → `/api/tasks`） |
| `pages/admin/workers` | 工人管理：档案增改 + 绑定码 + **扫一扫认领工人身份码** |
| `pages/admin/workerDetail` | 单人学习详情 + 专属绑定码（重发/作废） |
| `pages/admin/login` | 班组长登录页 = 微信登录页（openid 白名单制；`?k=` 带管理员码 key 时扫码登记） |
| `pages/settings/` | 设置页：应用信息（版本号/运行环境/基础库/数据模式/后端地址）+ 客服（电话直拨/微信邮箱复制）+ 隐私声明；管理端 tabBar 第四栏（工人端无 tabBar 不可见） |
| `utils/api.js` | 全部端点封装，`USE_MOCK` 总开关，所有请求自动带 `dev_id` |
| `utils/mock.js` | 假数据 = 本协议的字段契约 |
| `utils/qrcode.js` | 二维码 canvas 绘制（vendored weapp-qrcode，`drawQrcode({canvasId,_this,text,width,height})`） |
| `utils/voice.js` | TTS say() + ASR（WechatSI 插件优先，recorderManager 降级）；answer 答题 / commander 指令循环 |
| `config.js` | `API_BASE` + `USE_MOCK` + `MOCK_ROLE`（mock 角色开关，`'new'`=未绑定设备） |
| `app.js` | `wx.login` → `globalData.launchCode`；me / worker / sessionId / volume |

## 7. 联调步骤

1. 后端按 mock.js 的字段实现 7 个端点（先 `session/today` + `answer` + `finish` 三个就能跑全流程）
2. `config.js`：`USE_MOCK=false`，`API_BASE` 填后端地址（本地联调 `http://<局域网IP>:3000`，开发者工具勾"不校验合法域名"）
3. 验证顺序：字幕滚 → 读题 → 录音转文字 → verdict → next_steps 插入 → finish
4. 指令通道单独验：先 `commandText('暂停')` 走通 JSON 路径，再接真录音

## 8. TODO（联调时逐项补）

- [x] openid ↔ 工友档案绑定（二维码体系已实现，见 §10；AppSecret 已上服务器，jscode2session 换真 openid，wxacode 正式码可生成）
- [ ] `scope.record` 授权失败引导（`wx.getSetting` → 设置页）
- [x] TTS：阿里 NLS 服务端合成（`/api/tts` → mp3 → `say.audio_url`，InnerAudioContext 播放）；已实测闭环。WechatSI 插件因小程序类目受限不可用，已移除
- [x] ASR：阿里一句话识别（`/api/asr` wav 裸字节上传 → 按 worker.dialect 选 appkey）；已实测闭环（TTS 出声→ASR 识别回文字）
- [x] 指令音频转写：`/api/command` wav 裸字节 → 普通话模型识别 → 动作匹配
- [ ] 指令通道：回声过滤策略（模型侧 or PTT）
- [ ] `finish` 失败兜底文案/重试
- [ ] 答题超时（listen.timeout_ms）到时自动停录——`recorderManager.duration` 已生效，确认超时后 UI 态

## 9. 管理员端（同一小程序，按角色分流）

**一个程序两端，码 > 身份。** 扫什么码进什么端（门口码→工人学习流，管理员码→管理端，路由详情见 §10 末）；不扫码直接打开时第一个请求是 `/api/me`，后端按 openid 判角色：

```
扫门口码/不扫码且 role='worker' → training 页（学习流，普通页，无 tabBar）
扫管理员码/不扫码且 role='admin' → switchTab /pages/admin/push（管理端三界面：推送 / 学习情况 / 工人，底部 tabBar）
```

- **保密在服务端，不在 UI**：工人端是普通页，机制上就不渲染管理端 tabBar；`/api/admin/*` 与 `/api/workers/save`、`/api/tasks`、`/api/groups/save` 必须服务端按 openid 鉴权，工人 openid 调用一律 `403`。管理员 openid 存 `admins` 名单（独立于工人档案）。
- mock 演示：`config.js` 的 `MOCK_ROLE` 切 `'admin'`/`'worker'`；真机无此开关。
- 未绑定设备（`me` 返回 `need_bind`）：跳 `pages/bind/bind` 亮身份码/扫管理员码（见 §10）。

### 9.1 管理端端点

| 端点 | 请求 | 响应 |
|------|------|------|
| `/api/admin/overview` | `{ date? }`（缺省今天；查某天传 `YYYY-MM-DD`） | `{ date, task, stats, workers[] }` 见下 |
| `/api/admin/history` | `{}` | `{ days: [{date, done, total, avg_score}] }`（近 14 天汇总，往期列表用） |
| `/api/admin/worker` | `{ worker_id }` | `{ worker, today, stats, mastery[], review, records[] }` 见下（详情页） |
| `/api/admin/remind` | `{ worker_ids: [worker_id] }` | `{ ok, reminded, note }`（一键提醒未学工人；正式环境接订阅消息/语音外呼） |
| `/api/kb/search` | `{ query }`（工序文本） | `{ items: [{kb_id, title, doc_no, clause, summary, score}] }`（特征函数匹配的坑位；算法归编排器，现桩为关键词匹配） |
| `/api/content/list` | `{}` | `{ items: [{content_id, title, job_tag, kb_ids, kb[], points[], quiz[], draft}] }`（推送内容库 + 每条附 **AI 今日剧本** `draft: { date, generated_at, steps[], trace[] }`——steps 即工人端实际播放格式，trace 为六角色证据链；标题检索在前端做） |
| `/api/tasks` | `{ date?, task_text, note?, kb_ids?, target, env? }`（env=工作环境快照 `{ lat, lng, weather }`，见 §2 `/api/weather`；pushEdit 自动定位上送，管理员无需手填） | `{ ok, task_id, pushed_at, target_count, draft? }`——`draft`=`{ generated_at, point_count, quiz_count }`，**推送即生成**的剧本草稿回执：管理员一推送立刻生成（不等定时批量），`generated_at`=推送时刻 |
| `/api/tasks/list` | `{}` | `{ items: [{task_id, date, pushed_at, task_text, note, kb_ids, kb[], target, target_desc, target_count, pushed_by, env?}] }`（推送记录，新→旧；检索在前端做） |
| `/api/ai/recommend` | `{}` | `{ items: [{rec_id, title, content_id?, kb_ids, target, target_desc, reason, level}] }`（AI 预测推荐：复训逾期 × 薄弱点 × 内容匹配；reason 必须可解释——评审看的就是"为什么是这条推荐"。现桩为规则引擎，真模型归编排器） |
| `/api/groups` | `{}` | `{ groups: [{group_id, name, count}] }` |
| `/api/groups/save` | `{ name }` | `{ ok, group }`（重命名/删除暂未实现） |
| `/api/workers/save` | `{ worker: { worker_id?, name, age, years, job, group_id, phone?, dialect? } }` | `{ ok, worker, bind: { scene, qr_text, wxacode_url } }` |

**target 三种形态**：`'all'` 全部工人 | `'group:<group_id>'` 整组 | `'worker:<worker_id>'` 定向个人（"为他推送巩固内容"用）。`target_count` 按形态计算。

`/api/admin/worker` 响应（详情页数据）：

```jsonc
{ "worker": { "worker_id": "w001", "name": "王建国", "job": "架子工",
              "group_name": "一班", "phone_masked": "138****0001", "font_size": "xxl",
              "age": 52, "years": 18, "dialect": "山东话" },   // dialect: ASR 方言模型依据，见 §12
  "today": { "status": "done", "score": 80, "finished_at": "06:47" },
  "stats": { "total_days": 28, "streak": 6, "avg_score": 88 },
  "mastery": [ { "point": "连墙件设置要求", "value": 62, "status": "待巩固" } ],   // 升序，最薄弱在前
  "review": { "date": "2026-10-07", "point": "连墙件设置要求",
              "days_since": 4, "retention": 77 },   // retention=记忆保持率估算（SM-2 简化算法输出，UI 须标注"算法估算"）
  "behavior": { "pauses": 2, "repeats": 1,
                "note": "「连墙件设置要求」内容上暂停较多，可能存在理解难点，建议班前会口头确认" },
                           // 行为诊断（升级3：暂停/重听等学习行为数据的诊断结论；前端原样展示，勿自行解读）
  "records": [ { "date": "09-29", "full_date": "2026-09-29", "task_text": "二层模板支设",
                 "score": 70, "wrong_count": 2,
                 "wrongs": [ { "q": "…", "your": "…", "correct": "…" } ] } ],
  "next_review_date": "2026-10-07" }
```

**行为埋点（升级3 证据飞轮）**：工人端在 `finish` 时随请求上送 `events: [{type:'pause'|'repeat'|'answer_ms', step?, step_id?, at?, ms?}]`（暂停/重听/答题用时），服务端记入学习档案，供诊断与次日生成引用；响应 `received_events` 为回执计数。
```

`/api/admin/overview` 响应：

```jsonc
{ "date": "2026-09-30",
  "task": { "task_id": "task-001", "date": "2026-09-30",
            "task_text": "三层外墙脚手架搭设",   // 管理员只填这个
            "note": "连墙件、安全网是今天重点",
            "kb_ids": ["kb01", "kb02"],          // 推送时勾选的规范条目
            "pushed_by": "班组长-刘志强", "pushed_at": "06:30", "target": "all" },
  "stats": { "total": 12, "done": 9, "avg_score": 71,
             "done_diff": 0 },        // 较昨日已学人数增减；仅 date=今天时有意义，0 或查往期时前端不显示
  "workers": [
    { "worker_id": "w001", "name": "王建国", "job": "架子工", "group_id": "g1",
      "status": "done",      // done=当日已学 | pending=未学
      "score": 80, "finished_at": "06:47" }
  ] }
```

**约定：**

- `task` 与工人端联动：`/api/tasks` 推送后，下一次 `/api/session/today` 的 `task_text` 就是新内容——剧本由编排器按 `task_text × 工人档案 × kb_ids` 现场生成（特征函数匹配规范条目，管理员不选具体条文）。
- `env`（可选）= 推送时的工作环境快照：①工序解析把它作为「工作环境信息」输入（与 task_text 里抠出来的口头描述并列，且优先级更高——实测数据比口述准）；推送记录详情页展示天气摘要。定位失败/未授权时 env 缺省，链路不受影响。
- `task_text` 的前端来源（pushEdit，2026-10-06 改版）：管理员**自己说/填今日工作**（「按住说话」语音输入走 `/api/asr` 识别通道），不选预制内容；边输边联想历史推送（`/api/tasks/list` 前端去重过滤，点联想=填入并沿用那次的 `kb_ids`），另有「近两天推送」快捷行（今天+昨天去重，点一下同理沿用）；既没点联想也没点近两天行时，提交时现场 `/api/kb/search` 按工序文本检索出 `kb_ids`——管理员全程不选条文。内容库 `/api/content/list` 不再参与推送流程（保留给后续"资料库"界面）；AI 推荐 `/api/ai/recommend` 同日起不再进推送页（端点保留，看板/后续可用）。
- **数据安全（医院级信息管理）**：工人手机号在任何列表/详情响应里一律以 `phone_masked`（`138****0001`）下发，完整号码不出服务端；编辑时手机号留空 = 不修改；`/api/workers/save` 服务端校验手机号格式（11 位 `1` 开头）。管理端表单附隐私声明：信息仅用于安全培训与学习档案，不作绩效考核或处罚依据。
- `/api/workers/save` 无 `worker_id` = 新增；服务端按规则算 `font_size`（≥50 岁 xxl，≥40 xl，否则 l——只大不小）写进档案。
- `bind.scene`（`w=<worker_id>`）是工人绑定码的参数：**正式环境后端调 `wxacode.getUnlimited` 生成小程序码图片**返回给管理端打印张贴；工人首扫此码建立 openid↔档案绑定，之后扫工地门口的统一码也自动识人。骨架阶段只返回 scene 占位。
- 工人删除/离职状态、分组重命名/删除暂未实现，列入后端 TODO。

## 10. 二维码绑定体系（openid 即身份，工人零登录）

**码位布局**——微信扫一扫能唤起小程序的只有两类码：官方小程序码（scene 参数，后端 `wxacode.getUnlimited` 出图，需 AppSecret）和后台配置的普通链接码；小程序内 `wx.scanCode` 可扫任意文本码。设计按此分两层：

| 码 | 载体 | 内容 | 谁扫 |
|---|---|---|---|
| 工地门口码 | 打印固定 | 小程序码 `scene=r=gate` | 工人每天上班微信扫一扫 |
| 管理员码 | 班组长保存 | 小程序码 `scene=r=admin` | 班组长扫一扫 |
| 工人身份码（机制1） | 工人手机屏幕，**6 位 ticket，10min 一次性** | 文本码 `BQ5\|T\|<ticket>` | 管理员 app 内 wx.scanCode 或手输 |
| 工人绑定码（机制2） | 管理员生成可打印，每人唯一带防伪 key | `scene=w=<wid>&k=<key>`；降级文本码 `BQ5\|B\|<wid>.<key>` | 工人微信扫一扫 / app 内扫码 |

**机制1 时序（工人先扫码，管理员认领）：**
```
工人扫门口码 → /api/me 返回 need_bind → 跳 /pages/bind/bind
  → /api/bind/ticket → 屏幕出二维码 + 6 位手动码，前端每 4s 轮询 ticket
管理员（工人页"扫工人身份码绑定"）→ wx.scanCode → /api/bind/claim
  → {ticket} + {worker_id 选已有 | worker{...} 新建} → openid↔档案落库
工人端下次轮询 ticket 返回 bound:true → reLaunch 进学习流（**按门口码语义 `?scene=r%3Dgate` 跳入**——双重身份设备（管理员+工人）绑定完成后也落在工人端，不被"无场景直接打开"分流到管理端），全程零点击
```

**机制2 时序（管理员建档发码，工人自绑）：**
```
管理员（工人页保存档案 或 详情页"绑定码"）→ /api/bind/code → qr_text 画真码
工人微信扫一扫小程序码(scene=w=xxx&k=yyy) 或 app 内扫码/手输
  → /api/bind/resolve → 校验 key → openid↔档案落库 → 直接开始学
详情页"重发新码" → regenerate=true → 旧 key 作废（码外流后可吊销）
```

**绑定端点（已实现，api.maomaozhao.cn 在线）：**

| 端点 | 请求 | 响应 |
|------|------|------|
| `/api/bind/ticket` | `{openid\|dev_id\|code}` | `{bound:false, ticket, qr_text:'BQ5\|T\|…', manual_code, expires_in}`；已绑则 `{bound:true, worker}` |
| `/api/bind/claim` | `{ticket, worker_id? \| worker:{…}}` | `{ok, worker}`（**仅管理员**，工人调 403；ticket 一次性，过期/已用报错） |
| `/api/bind/code` | `{worker_id, regenerate?}` | `{worker_id, key, qr_text:'BQ5\|B\|wid.key', scene:'w=wid&k=key', wxacode_url}`（仅管理员） |
| `/api/bind/resolve` | `{code\|scene}`（BQ5\|B 文本 或 w=…&k=…） | `{ok, worker}`；key 错→"已失效" |
| `/api/admin/activate` | `{code, qr_key}`（code=wx.login 的；qr_key=管理员码内嵌 key） | `{ok, role:'admin'}` 登记进白名单 |
| `/api/wxacode` | `{scene, page?}` | `{image_url:'/codes/xxx.jpg'}`（已接真 wxacode.getUnlimited，`env_version=trial` 指体验版；仅管理员） |

**入口 scene 路由（training.onLoad `parseScene`）——铁律：码 > 身份，扫什么码进什么端；只有不扫码直接打开，才按 openid 角色分流：**
- `r=admin&k=<key>` → 已激活管理员→管理端 tab；非管理员→`pages/admin/login?k=<key>` 扫码登记（码即凭证）；无 k→login 页纯微信登录
- `r=gate`（门口码）→ **一律进工人学习流**：已绑工人直接学；未绑定设备→`pages/bind/bind`；管理员扫门口码=体验工人端（mock 模式给演示工友 `api.demoWorker()`，真链路无工人档案→绑定页）
- `w=<wid>&k=<key>` → 未绑定设备原地 `/api/bind/resolve` 自绑后学习；已绑定忽略
- 无 scene 直接打开 → 按 `/api/me` 角色分流：admin→管理端 tab；worker→学习流；need_bind→绑定页

**约定：**
- `dev_id`：api.js 自动注入的本机持久随机串，jscode2session 不可用时的降级身份；WX_APPID/WX_SECRET 已配在服务器 systemd（`/etc/systemd/system/banqian.service.d/wx.conf`），真机走真 openid。
- **dev_id ↔ openid 别名表（2026-10-05 修复）**：`/api/me`（带 code）解析出真 openid 时，服务端记录 `devToOpenid[dev_id]=openid`（随 store 持久化）；此后不带 code 的请求（bind/admin 系列）经别名表还原真 openid——真机上"激活存真 openid、绑定认 dev_id"导致的管理端 403 与绑定落空已修复。
- **双重身份（2026-10-06）**：同一 openid 既在管理员白名单又绑了工人档案时，`/api/me` 返回 `role:'admin'` **且带 `worker`**——配合「码 > 身份」路由：扫门口码拿 `worker` 直接进学习流，直接打开/扫管理员码进管理端（管理员的手机也能当工人用，不用二选一）。
- ticket 轮询幂等：服务端对同 openid 未过期未用的 ticket 直接复用，码面不抖动。
- 管理端接口鉴权按 `resolveOpenid` 出的 openid 判白名单——`**adminOpenids**`（后端内存桩，重启丢，正式进数据库）。

### 9.2 管理端 TODO（并入 §8）

- [ ] admin 接口 openid 鉴权中间件（403 语义；当前逐 handler `isAdmin` 判断，可收敛）
- [x] `wxacode.getUnlimited` 生成绑定码图片 + 管理端展示/保存图片（已通：`/api/bind/code` 返 `wxacode_url`，前端 `<image>` 优先、文本码降级；码图 `GET /codes/*.jpg`）
- [ ] overview/history/worker 接真实学习记录表（现在 mock/桩是确定性伪随机：同 key 恒定、跨日重排）
- [ ] remind 接订阅消息/语音外呼（现在只回执）
- [ ] `/api/kb/search` 换特征函数真匹配（另一个对话的主线）
- [ ] 工人离职/停用状态字段；分组重命名/删除

## 11. 打断提问通道（工人发起 → 模型回答 → 剧本可改写）

朗读期（`phase=read`）工人随时可打断：点「没听懂 ?」悬浮钮，或直接说"不懂/什么意思/为啥"（command `ask` 动作）。

```
前端动作序列（已实现 tapAsk）：
  1. voice.pause() 暂停 TTS + 停指令监听 + 停行滚动（rowPlay 保留，失败可续）
  2. 录问题 ≤30s（"说完了"手动停 / 到时自动停）→ 文字入字幕流："你的问题：…"
  3. POST /api/ask {session_id, step_id, question}   // step_id=被打断的步
  4. 等待期：stageText="老师傅在想…"（模型 1-3s 延迟的体感遮罩）
  5. 响应 → spliceAsk 拼接 → 继续执行
```

**`/api/ask` 响应语义：**

```jsonc
{ "steps": [ /* Step[] */ ],      // 模型回答（通常 1 个 say；也可带 ask 追问/完整改写）
  "replay_current": true,         // true → 答完把被打断的步重讲一遍（衔接上下文，推荐）
  "drop_rest": false }            // true → 当前步之后的剩余剧本作废，由 steps 接管
```

**拼接规则（前端 spliceAsk 已实现）：**

```
queue = q[0..i) + steps + (replay_current ? [被打断的步] : []) + (drop_rest ? [] : q[i+1..])
然后从 index i 继续执行（steps[0] 落位 i）。
```

**后端职责：**
- **回答的知识来源 = 当日剧本生成时的 RAG 命中集**（铁律）。剧本生成时检索命中的规范条目（draft.trace「规范检索」+ task.kb_ids）随 session 存留；答疑时**只按命中集条文回答**——不能只凭剧本文字（剧本是生成物，信息有损），更不能脱离命中集自由发挥（防幻觉）。命中集没有的，一律答"这个得问你们安全员，我记下来了"（超纲转人工 + 记待审队列，正好反哺本地库）。
- 结合当前步内容 + 工人档案（dialect/mastery/薄弱点）生成口语化回答——大白话、一两句能听懂
- 需要"答完后内容变了"→ `drop_rest:true` + steps 直接给新的剩余剧本
- 提问里也塞进 `ask` 步做追问确认，走 `/api/answer` 同一判定链路
- 前端兜底：`/api/ask` 报错 → 提示失败并原位置续播（resumeAfterQa）

## 12. 方言/语音模型（worker.dialect 字段）

**结论：阿里一句话识别的方言是按 appkey/项目绑定模型的**——控制台建项目时选模型（普通话/四川话/粤语/河南话…），不同方言对应不同选择，不是一个模型通吃。所以工人档案必须带语言字段：

- `worker.dialect`：`'普通话'|'山东话'|'四川话'|'粤语'|'河南话'|'东北话'|'其他'`，管理端表单已加选择器（默认普通话）
- 后端职责：`dialect → appkey/模型` 映射表，按工人维度调用对应识别模型；`/api/asr` 请求已带 `dev_id`→openid→可查出 worker.dialect
- 前端 wechatSI 插件路径：可映射 `zh_CN/zh_HK/sichuanhua`，识别不了的方言走服务端阿里通道
- TTS 播放端始终是普通话（工人听得懂即可），方言只影响**识别侧**

## 13. 前端依赖清单（后端交付最小契约）

前端只认字段不认实现——下面这份是"后端必须给前端什么"的总表，替代它的是同一个 JSON 形状：

| 时机 | 端点 | 前端要的关键字段 |
|------|------|------------------|
| 打开小程序 | `/api/me` | `role`、`worker`（已绑）、`need_bind` |
| 身份码 | `/api/bind/ticket` | `ticket`、`qr_text`（或 `bound:true+worker`） |
| 管理员认领 | `/api/bind/claim` | `worker`（确认 toast 用） |
| 管理员发码 | `/api/bind/code` | `qr_text` 或 `wxacode_url`（二选一，都有优先用官方图） |
| 工人自绑 | `/api/bind/resolve` | `worker` |
| 管理员扫码登记 | `/api/admin/activate` | `ok`（失败给 `error` 文案） |
| 拉剧本 | `/api/session/today` | `session_id`、`worker`、`steps[]`（Step schema §3） |
| 答题判分 | `/api/answer` | `verdict`、`next_steps[]`（可空） |
| 打断提问 | `/api/ask` | `steps[]`、`replay_current`、`drop_rest` |
| 语音指令 | `/api/command` | `{action, direction?, value?}`，`none` 兜底 |
| 结束结算 | `/api/session/finish` | `score`、`wrong_items[]`、`next_review_date`、`mastery_update`（result 页全展示） |
| 管理端看板/详情/推送/档案 | §9.1 各表 | 见 §9.1 |

**字段之外的硬约定：**
- 所有 admin 接口服务端按 openid 鉴权（403 语义），前端不校验
- 手机号只下发 `phone_masked`；`font_size` 服务端算好下发
- steps 的 `id` 全局唯一（重问/追问步后缀 `-re`/`-var`）
- 任意端点可返回 `{error:'人类可读文案'}`——前端 toast 原样展示



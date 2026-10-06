// 班前五分钟 · 后端骨架（协议契约实现，无依赖）
// 端点契约见 miniprogram/PROTOCOL.md；六角色编排器就在本文件的 handler 里替换生长
const http = require('http')
const https = require('https')
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3000

/* ================= 持久化（JSON 文件桩；HANDOFF §8 schema，后换 SQLite 同接口） ================= */
const STORE_FILE = path.join(__dirname, 'store.json')
let store = {}
try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) } catch (e) {}
function saveStore() {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(store)) } catch (e) {}
}
// 全量快照（小数据量直接整存；换 SQLite 时拆表）
function persist() {
  store.workers = workers
  store.groups = groups
  store.openidBinds = openidBinds
  store.adminOpenids = adminOpenids
  store.bindKeys = bindKeys
  store.todayTask = todayTask
  store.pushRecords = pushRecords
  store.pendingQuestions = pendingQuestions
  store.devToOpenid = devToOpenid
  saveStore()
}
// 运行时会话（session_id → {worker_id, steps, rag_hits, answers}）——生命周期短，不落盘
const sessions = {}

/* ================= 微信服务端 API（WX_APPID/WX_SECRET 环境变量，只进 systemd，不进代码） ================= */
const WX_APPID = process.env.WX_APPID || ''
const WX_SECRET = process.env.WX_SECRET || ''
const CODES_DIR = path.join(__dirname, 'codes')
try { fs.mkdirSync(CODES_DIR, { recursive: true }) } catch (e) {}

function httpGet(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'Accept-Encoding': 'gzip, deflate' } }, r => {
      // 有些 API（和风天气）会回 gzip 压缩流，按 content-encoding 解压后再给调用方
      let stream = r
      const enc = r.headers['content-encoding']
      if (enc === 'gzip') stream = r.pipe(zlib.createGunzip())
      else if (enc === 'deflate') stream = r.pipe(zlib.createInflate())
      const c = []
      stream.on('data', d => c.push(d))
      stream.on('end', () => res(Buffer.concat(c)))
      stream.on('error', rej)
    }).on('error', rej)
  })
}
function httpPost(url, obj) {
  return new Promise((res, rej) => {
    const body = Buffer.from(JSON.stringify(obj))
    const u = new URL(url)
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, resp => {
      const c = []
      resp.on('data', d => c.push(d))
      resp.on('end', () => res(Buffer.concat(c)))
    })
    r.on('error', rej)
    r.write(body)
    r.end()
  })
}

// access_token 缓存（7200s 有效，提前 5min 刷新）
let wxToken = { token: '', exp: 0 }
async function wxAccessToken() {
  if (!WX_APPID || !WX_SECRET) return null
  if (wxToken.exp > Date.now()) return wxToken.token
  try {
    const j = JSON.parse((await httpGet(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_SECRET}`
    )).toString())
    if (!j.access_token) return null
    wxToken = { token: j.access_token, exp: Date.now() + (j.expires_in - 300) * 1000 }
    return wxToken.token
  } catch (e) { return null }
}

// wx.login code → 真 openid（失败/未配置 → null，调用方降级 dev_id）
async function wxOpenid(code) {
  if (!WX_APPID || !WX_SECRET || !code) return null
  try {
    const j = JSON.parse((await httpGet(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    )).toString())
    return j.openid || null
  } catch (e) { return null }
}

// wxacode.getUnlimited → 生成小程序码图存 codes/，由本服务 GET /codes/ 对外服务
// env_version=trial：小程序未发布期间，码指向体验版（仅项目成员可扫）
async function wxacodeImage(scene, page) {
  const token = await wxAccessToken()
  if (!token) return null
  try {
    const buf = await httpPost(
      `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`,
      { scene, page: page || 'pages/training/training', width: 430, env_version: 'trial', check_path: false }
    )
    if (buf[0] === 0x7b) return null   // '{' = JSON 错误响应而非图片
    const name = 'c' + Math.abs(hash(scene + (page || ''))).toString(36) + '.jpg'
    fs.writeFileSync(path.join(CODES_DIR, name), buf)
    return '/codes/' + name
  } catch (e) { return null }
}

/* ================= 天气（和风 API 代理；QWEATHER_KEY/QWEATHER_HOST 只进 systemd，不进代码） ================= */
// 小程序 wx.getLocation(wgs84) 拿经纬度 → 本端点代理调和风格点实时天气
// 没配 Key / 调用失败 → 桩数据兜底（source:'stub'），演示永不断链
const QWEATHER_KEY = process.env.QWEATHER_KEY || ''
const QWEATHER_HOST = process.env.QWEATHER_HOST || 'devapi.qweather.com'   // 新版控制台分配的专属 host 用 env 覆盖
const weatherCache = {}   // ~1km 网格 → { t, weather }（30min TTL，免费额度友好）

function stubWeather(lat, lng, note) {
  return {
    temp: '26', feels_like: '27', text: '多云',
    wind_dir: '东南风', wind_scale: '3', wind_speed: '12',
    humidity: '55', precip: '0.0', pressure: '1008', vis: '25',
    obs_time: new Date().toISOString(),
    source: 'stub', note: note || '未配置 QWEATHER_KEY，返回演示天气',
    risk_level: 'normal', risk_hints: []
  }
}

// 确定性层：天气 → 作业风险提示（函数干确定性的事，不让 LLM 推；≥6级风条款对接评测 TS-4 补库场景）
function withRiskHints(w) {
  const hints = []
  const ws = parseInt(w.wind_scale, 10) || 0
  const t = parseInt(w.temp, 10)
  const vis = parseFloat(w.vis)
  const text = w.text || ''
  if (ws >= 6) hints.push({ level: 'high', text: `${ws}级大风：停止露天高处作业与起重吊装（六级风条款）` })
  else if (ws === 5) hints.push({ level: 'warn', text: '5级风：高处作业加强防护，材料工具防止吹落' })
  if (/雷/.test(text)) hints.push({ level: 'high', text: '雷电天气：停止露天作业，远离塔吊、脚手架等金属构架' })
  else if (/雨|雪|冰雹/.test(text)) hints.push({ level: 'warn', text: `${text}天气：作业面注意防滑，临时用电加强检查` })
  if (!isNaN(t) && t >= 35) hints.push({ level: 'high', text: `高温 ${t}°C：防暑降温，避开午间高温时段作业` })
  else if (!isNaN(t) && t <= 5) hints.push({ level: 'warn', text: `低温 ${t}°C：注意防寒，混凝土浇筑加强养护` })
  if (!isNaN(vis) && vis < 1) hints.push({ level: 'warn', text: `能见度仅 ${vis}km：吊装作业加强信号指挥` })
  w.risk_hints = hints
  w.risk_level = hints.some(h => h.level === 'high') ? 'high' : hints.length ? 'warn' : 'normal'
  return w
}

async function fetchWeather(lat, lng) {
  const grid = `${lat.toFixed(2)},${lng.toFixed(2)}`   // 缓存键：~1km 网格
  const hit = weatherCache[grid]
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.weather
  if (!QWEATHER_KEY) return stubWeather(lat, lng)
  try {
    // 和风格点实时天气：location=经度,纬度（wgs84 直传，公里级网格无需纠偏）
    const url = `https://${QWEATHER_HOST}/v7/grid-weather/now?location=${lng.toFixed(4)},${lat.toFixed(4)}&key=${QWEATHER_KEY}`
    const buf = await httpGet(url)
    const r = JSON.parse(buf.toString())
    if (r.code !== '200' || !r.now) throw new Error('qweather code=' + (r.code || (r.error && r.error.title) || 'unknown'))
    const n = r.now
    const weather = withRiskHints({
      temp: n.temp, feels_like: n.feelsLike, text: n.text,
      wind_dir: n.windDir, wind_scale: n.windScale, wind_speed: n.windSpeed,
      humidity: n.humidity, precip: n.precip, pressure: n.pressure, vis: n.vis,
      obs_time: n.obsTime, source: 'qweather'
    })
    weatherCache[grid] = { t: Date.now(), weather }
    return weather
  } catch (e) {
    return stubWeather(lat, lng, '和风天气调用失败（' + String(e && e.message || e) + '），已降级演示数据')
  }
}

/* ================= 阿里云智能语音交互 NLS（ALI_AK_ID/ALI_AK_SECRET/NLS_APPKEY env） ================= */
const crypto = require('crypto')
const ALI_AK_ID = process.env.ALI_AK_ID || ''
const ALI_AK_SECRET = process.env.ALI_AK_SECRET || ''
const NLS_APPKEY = process.env.NLS_APPKEY || ''
const TTS_DIR = path.join(__dirname, 'tts')
try { fs.mkdirSync(TTS_DIR, { recursive: true }) } catch (e) {}

// 方言 → appkey 覆盖表：NLS_APPKEY_<方言> 环境变量，无则回落默认 NLS_APPKEY
function nlsAppkey(dialect) {
  const k = 'NLS_APPKEY_' + (dialect || '普通话')
  return process.env[k] || NLS_APPKEY
}

// pop RPC 签名（AccessKey → NLS Token 用；文档：POP 签名规则，GET + HMAC-SHA1）
function popSign(params) {
  const enc = s => encodeURIComponent(String(s))
    .replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
  const all = {
    Format: 'JSON', Version: '2019-02-28', SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: Date.now() + Math.random().toString(36).slice(2),
    SignatureVersion: '1.0', AccessKeyId: ALI_AK_ID,
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    RegionId: 'cn-shanghai', ...params
  }
  const qs = Object.keys(all).sort().map(k => enc(k) + '=' + enc(all[k])).join('&')
  const sig = crypto.createHmac('sha1', ALI_AK_SECRET + '&').update('GET&' + enc('/') + '&' + enc(qs)).digest('base64')
  return qs + '&Signature=' + enc(sig)
}

// NLS token 缓存（默认 32h，提前 60s 刷新）
let nlsTok = { id: '', exp: 0 }
async function nlsToken() {
  if (!ALI_AK_ID || !ALI_AK_SECRET) return null
  if (nlsTok.exp > Date.now()) return nlsTok.id
  try {
    const j = JSON.parse((await httpGet(
      'https://nls-meta.cn-shanghai.aliyuncs.com/?' + popSign({ Action: 'CreateToken' })
    )).toString())
    if (j.Token && j.Token.Id) {
      nlsTok = { id: j.Token.Id, exp: j.Token.ExpireTime * 1000 - 60000 }
      return nlsTok.id
    }
  } catch (e) {}
  return null
}

// POST 原始字节（带自定义头），返回 Buffer
function httpPostRaw(url, buf, headers) {
  return new Promise((res, rej) => {
    const u = new URL(url)
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Length': buf.length, ...(headers || {}) }
    }, resp => {
      const c = []
      resp.on('data', d => c.push(d))
      resp.on('end', () => res(Buffer.concat(c)))
    })
    r.on('error', rej)
    r.write(buf)
    r.end()
  })
}

// 一句话识别：wav 字节 → 文字；dialect 决定 appkey（方言模型按 appkey 绑定）
async function nlsAsr(wavBuf, dialect) {
  const token = await nlsToken()
  const appkey = nlsAppkey(dialect)
  if (!token || !appkey) return ''
  try {
    const buf = await httpPostRaw(
      `https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr?appkey=${appkey}&format=wav&sample_rate=16000&enable_punctuation_prediction=true`,
      wavBuf,
      { 'X-NLS-Token': token, 'Content-Type': 'application/octet-stream' }
    )
    const j = JSON.parse(buf.toString())
    return j.result || ''
  } catch (e) { return '' }
}

// TTS：文本 → mp3 存 tts/，返回 /tts/xx.mp3 相对路径。文件名=内容哈希→同文命中缓存不重复调阿里
async function nlsTts(text) {
  if (!text) return null
  const name = 't' + Math.abs(hash(String(text))).toString(36) + '.mp3'
  const rel = '/tts/' + name
  if (fs.existsSync(path.join(TTS_DIR, name))) return rel   // 合成缓存命中
  const token = await nlsToken()
  if (!token || !NLS_APPKEY) return null
  try {
    const qs = `appkey=${NLS_APPKEY}&token=${encodeURIComponent(token)}&text=${encodeURIComponent(String(text))}` +
      `&format=mp3&sample_rate=16000&voice=xiaoyun&speech_rate=0&pitch_rate=0`
    const buf = await httpPostRaw(`https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/tts?${qs}`, Buffer.alloc(0), {})
    if (buf[0] === 0x7b) return null   // '{' = JSON 错误
    fs.writeFileSync(path.join(TTS_DIR, name), buf)
    return rel
  } catch (e) { return null }
}

// 给一批 step 预挂音频（阿里 TTS 并发≤2，超过会被拒；串行小批 + 内容缓存，二次请求瞬时）
async function withAudio(list) {
  const targets = list.filter(s => s && s.text)
  for (let i = 0; i < targets.length; i += 2) {
    await Promise.all(targets.slice(i, i + 2).map(async s => {
      const u = await nlsTts(s.text)
      if (u) s.audio_url = u
    }))
  }
  return list
}

/* ================= LLM 三通道（OpenAI 兼容协议；LLM_BASE_URL/LLM_KEY/LLM_MODEL 只进 systemd） ================= */
// 骨架支持三通道降级（LLM_KEY_2/LLM_MODEL_2、LLM_KEY_3/LLM_MODEL_3 预留），当前先通一路；
// 缺 key / 调用失败 / 输出不合 schema → 一律回落工程占位实现，演示永不断链
const LLM_CHANNELS = [
  { base: process.env.LLM_BASE_URL || 'https://api.deepseek.com', key: process.env.LLM_KEY || '', model: process.env.LLM_MODEL || 'deepseek-chat' },
  { base: process.env.LLM_BASE_URL_2 || '', key: process.env.LLM_KEY_2 || '', model: process.env.LLM_MODEL_2 || '' },
  { base: process.env.LLM_BASE_URL_3 || '', key: process.env.LLM_KEY_3 || '', model: process.env.LLM_MODEL_3 || '' }
].filter(c => c.base && c.key)
const llmReady = () => LLM_CHANNELS.length > 0

function httpPostLLM(url, obj, timeoutMs) {
  return new Promise((res, rej) => {
    const body = Buffer.from(JSON.stringify(obj))
    const u = new URL(url)
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Authorization': 'Bearer ' + obj.__key }
    }, resp => {
      const c = []
      resp.on('data', d => c.push(d))
      resp.on('end', () => res(Buffer.concat(c)))
    })
    r.on('error', rej)
    r.setTimeout(timeoutMs || 25000, () => { r.destroy(new Error('llm timeout')) })
    r.write(body)
    r.end()
  })
}

// chat(messages, {json, temperature, max_tokens, timeout_ms}) → content 文本；失败 throw（上层决定回落）
async function llmChat(messages, opt) {
  opt = opt || {}
  if (!LLM_CHANNELS.length) throw new Error('LLM 未配置 key')
  let lastErr = null
  for (const ch of LLM_CHANNELS) {
    try {
      const body = {
        model: ch.model, messages,
        temperature: opt.temperature != null ? opt.temperature : 0.3,
        max_tokens: opt.max_tokens || 1000, stream: false, __key: ch.key
      }
      if (opt.json !== false) body.response_format = { type: 'json_object' }
      const buf = await httpPostLLM(ch.base.replace(/\/$/, '') + '/chat/completions', body, opt.timeout_ms || 25000)
      const j = JSON.parse(buf.toString())
      if (j.error) throw new Error(j.error.message || 'llm error')
      const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content
      if (!c) throw new Error('empty content')
      return { content: c, channel: ch.model }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('llm all channels failed')
}

// 取 JSON：容忍模型包 markdown 围栏或前后碎话
function llmJson(text) {
  let s = String(text).trim()
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) s = m[1].trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  return JSON.parse(s)
}

/* ---------- 判分 agent（特征函数 v1，评委版附录 A.2 全文口径；输出过 schema 校验+不变量机检） ---------- */
async function gradeWithLLM(question, expect, hits, answerText) {
  const CN = ['①', '②', '③', '④', '⑤']
  const expectPoints = (expect || []).map((g, i) => `${CN[i] || '・'} ${g[0]}`).join('；') || '（无要点清单，按题意判）'
  const hitText = hits.map(k => `${k.doc_no}${k.clause}：${k.summary}`).join('\n') || '（空）'
  const sys = '你是「班前五分钟」的判分角色。你只按《判分函数 v1》分析，不凭感觉。'
  const user = `【本次输入】
answer_text（ASR 原文）："${answerText}"
题目："${question}"
expect 要点：${expectPoints}
判分事实边界（只允许依据以下条文）：
${hitText}

【分析方法——逐步执行，不许跳步】
第〇步 ASR 可信度（闸门）：文本破碎到无法还原语义 → 直接判 unknown，终止分析。
第一步 要点覆盖（50%）：逐条对照 expect，每条给命中/未命中，命中必须能在 answer_text 原文找到作证。
第二步 错误性质（30%，含否决权）：区分 无知/误认/陈旧错误经验/泛化正确；误认或陈旧错误经验（"以前都这么干"）一经确认，无论覆盖多少 → 直接 wrong；陈旧错误经验且语气肯定 → red_flag=true。
第三步 置信与犹豫（20%）："……来着？""……吧""大概"式犹豫，在要点覆盖基础上降半档。

【判定映射——最终 verdict 只能从这里得出】
correct = 要点全部命中，无错误认知，无犹豫
partial = 命中部分；或方向正确但数值不确定/带犹豫；或泛化正确
wrong   = 几乎未命中；或误认；或陈旧错误经验
unknown = 仅第〇步闸门触发

【导向声明】1.鼓励优先：reason 先肯定答对的部分，再指出缺失。2.宁 unknown 不 wrong：听不清不冤枉工人。3.自信错最危险：red_flag 顶格——他以为他会。

【输出——只输出这个 JSON，不多一个字】
{"verdict":"correct|partial|wrong|unknown","missing":["缺失要点"],"evidence":["answer_text 原文片段"],"red_flag":false,"reason":"≤40字，口语，说给工人听；先肯定后指出；绝不写出正确答案的数值"}`

  const r = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 420, timeout_ms: 22000 })
  const j = llmJson(r.content)
  // 工程层：schema 校验 + 不变量机检（不合即 throw，上层回落桩判分）
  if (!['correct', 'partial', 'wrong', 'unknown'].includes(j.verdict)) throw new Error('verdict 非法: ' + j.verdict)
  if (Array.isArray(j.evidence) && j.evidence.some(e => typeof e === 'string' && e.length > 4 && !answerText.includes(e))) j.evidence = []   // 证据必须 ⊆ 原文，伪造即清空
  j.red_flag = !!j.red_flag
  j.missing = Array.isArray(j.missing) ? j.missing.map(String).slice(0, 5) : []
  j.reason = String(j.reason || '').slice(0, 80)
  return j
}

/* ---------- 答疑 agent（命中集锚定铁律；越界率 0；hazard_flag 隐患上报） ---------- */
async function askWithLLM(question, hits, stepText) {
  const hitText = hits.map(k => `${k.doc_no}${k.clause}：${k.summary}`).join('\n') || '（空）'
  const sys = '你是「班前五分钟」的答疑老师傅。你只按当日命中集回答，命中集之外一个字都不编。'
  const user = `【当日规范命中集（你的全部知识边界）】
${hitText}
【当前正在播的内容】${stepText || '（无）'}
【工人的问题】"${question}"

【规则】
1. 只在命中集里找答案：命中 → 一两句大白话告诉工人怎么做，并点出是哪条规定（文号条款）。
2. 命中集没有 / 不确定 → in_hits=false，answer 固定为"这个得问你们安全员，我记下来了"，绝不允许硬答。
3. 如果工人的话暴露了现场安全隐患（比如"栏杆被人拆了""安全网破着洞还在干"）→ hazard_flag=true 并用一句话写 hazard_desc。

【输出——只输出这个 JSON】
{"in_hits":true,"answer":"大白话","hazard_flag":false,"hazard_desc":""}`

  const r = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 300, timeout_ms: 22000 })
  const j = llmJson(r.content)
  if (typeof j.in_hits !== 'boolean') throw new Error('in_hits 非布尔')
  j.answer = String(j.answer || '').slice(0, 200)
  if (j.in_hits && !j.answer) throw new Error('命中但无回答')
  j.hazard_flag = !!j.hazard_flag
  j.hazard_desc = String(j.hazard_desc || '').slice(0, 100)
  return j
}

/* ---------- 剧本生成 agent（§7 导向声明：4~6 分钟、引用命中率 100%、口语化、不教操作不编数值） ---------- */
async function scriptWithLLM(taskText, hits, weakPoint) {
  const hitText = hits.map(k => `【${k.kb_id}】${k.doc_no}${k.clause}：${k.summary}`).join('\n') || '（空——库缺口，只用无出处提示句式）'
  const sys = '你是「班前五分钟」的内容生成角色，把当日工序变成建筑工人听得懂的班前微培训剧本。'
  const user = `【今日工序】"${taskText}"
【当日规范命中集（你的知识原料，每个知识点必须锚到这里）】
${hitText}
${weakPoint ? `【该班急迫榜第一】"${weakPoint}"——复习段优先讲它` : ''}

【写法要求——违反任何一条剧本作废】
1. 朗读总量控制在 4~6 分钟：正文要点 4~6 条，每条 40~70 字，讲透"是什么/数值/为什么/后果"，无寒暄句。
2. 引用命中率 100%：只许使用命中集里的规定；命中集没有的知识点不许写；数值一律照抄命中集原文，不编数。
3. 口语化：像班组长说话，不靠方言词；不教操作、不叫人找人、不编库外指令（行动指挥权归班组长）。
4. 考题 2 道：一道考今日内容，一道考旧内容/易错点；每题给判分要点组（同义词一组）和一道情景变式追问。
5. 库缺口只用固定句式"具体听安全员安排"，不许编造。

【输出——只输出这个 JSON】
{"points":["要点1","要点2",…],
 "quiz":[{"q":"考题","expect":[["关键词","同义词"],["关键词"]],"var_q":"情景变式追问"},
         {"q":"考题","expect":[["关键词"]],"var_q":"情景变式追问"}]}`

  const r = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], { max_tokens: 2200, temperature: 0.6, timeout_ms: 45000 })
  const j = llmJson(r.content)
  // 工程层校验：形状不合即 throw → 上层回落内容库拼装
  if (!Array.isArray(j.points) || j.points.length < 3 || j.points.length > 6) throw new Error('points 数量非法')
  j.points = j.points.map(p => String(p).trim()).filter(p => p.length >= 10 && p.length <= 120)
  if (j.points.length < 3) throw new Error('points 过短')
  if (!Array.isArray(j.quiz) || !j.quiz.length) throw new Error('quiz 为空')
  j.quiz = j.quiz.slice(0, 2).map(q => {
    if (!q || typeof q.q !== 'string' || !Array.isArray(q.expect)) throw new Error('quiz 形状非法')
    const expect = q.expect.map(g => (Array.isArray(g) ? g : [g]).map(String).filter(Boolean)).filter(g => g.length)
    if (!expect.length) throw new Error('expect 为空')
    return { q: q.q.trim(), expect, var_q: String(q.var_q || '').trim() || null }
  })
  return j
}

// 处理库检索打分（确定性层；请求只有工序文本时靠它圈定命中集）：keywords 命中加权 + 单字重合
function kbSearchItems(query) {
  const q = String(query || '').trim()
  if (!q) return []
  const items = KB.map(k => {
    let score = 0
    for (const kw of k.keywords) if (q.includes(kw)) score += 32
    for (const ch of q) if (/[一-龥]/.test(ch) && (k.summary.includes(ch) || k.title.includes(ch))) score += 1
    return { ...k, score: Math.min(99, score) }
  }).filter(k => k.score > 3).sort((a, b) => b.score - a.score).slice(0, 5)
  return items.length ? items : KB.slice(0, 3).map(k => ({ ...k, score: 75 }))   // 兜底前三条，保证锚点不缺位
}

/* ================= 分组与工人 ================= */

const groups = store.groups || [
  { group_id: 'g1', name: '一班' },
  { group_id: 'g2', name: '二班' },
  { group_id: 'g3', name: '塔吊组' }
]

const workers = store.workers || [
  { worker_id: 'w001', name: '王建国', age: 52, years: 18, job: '架子工',   font_size: 'xxl', group_id: 'g1', phone: '13864120001' },
  { worker_id: 'w002', name: '李铁柱', age: 34, years: 6,  job: '钢筋工',   font_size: 'l',   group_id: 'g1', phone: '13964120002' },
  { worker_id: 'w003', name: '张有财', age: 46, years: 12, job: '混凝土工', font_size: 'xl',  group_id: 'g1', phone: '13764120003' },
  { worker_id: 'w004', name: '刘长顺', age: 58, years: 25, job: '木工',     font_size: 'xxl', group_id: 'g2', phone: '13864120004' },
  { worker_id: 'w005', name: '陈大勇', age: 41, years: 9,  job: '电工',     font_size: 'xl',  group_id: 'g2', phone: '13664120005' },
  { worker_id: 'w006', name: '赵四海', age: 55, years: 20, job: '塔吊司机', font_size: 'xxl', group_id: 'g3', phone: '13564120006' },
  { worker_id: 'w007', name: '孙立秋', age: 38, years: 7,  job: '钢筋工',   font_size: 'l',   group_id: 'g1', phone: '13864120007' },
  { worker_id: 'w008', name: '周满仓', age: 49, years: 15, job: '混凝土工', font_size: 'xl',  group_id: 'g2', phone: '13964120008' },
  { worker_id: 'w009', name: '吴永强', age: 29, years: 4,  job: '架子工',   font_size: 'l',   group_id: 'g1', phone: '13764120009' },
  { worker_id: 'w010', name: '郑福生', age: 61, years: 30, job: '木工',     font_size: 'xxl', group_id: 'g2', phone: '13864120010' },
  { worker_id: 'w011', name: '马小刚', age: 26, years: 2,  job: '电工',     font_size: 'l',   group_id: 'g3', phone: '13664120011' },
  { worker_id: 'w012', name: '高守义', age: 44, years: 11, job: '塔吊司机', font_size: 'xl',  group_id: 'g3', phone: '13564120012' }
]

// 手机号脱敏：列表一律显示掩码（数据安全表达）
const maskPhone = p => (p && p.length === 11) ? p.slice(0, 3) + '****' + p.slice(7) : (p || '')
const groupName = gid => (groups.find(g => g.group_id === gid) || {}).name || '未分组'

// 管理员 openid 名单（持久化；'admin' 为联调占位身份，ADMIN_OPENIDS env 可预置名单）
const adminOpenids = store.adminOpenids || (process.env.ADMIN_OPENIDS || 'admin').split(',').map(s => s.trim()).filter(Boolean)
// 管理员码内嵌 key：扫到带此 key 的管理员码即激活（码本身就是凭证，无需输口令）
const ADMIN_QR_KEY = process.env.ADMIN_QR_KEY || 'bq5-admin-demo'

/* ================= openid 绑定（二维码体系核心） ================= */

// openid → worker_id。扫门口码进来后靠它识人，唯一持久凭据
const openidBinds = store.openidBinds || { 'dev-w001': 'w001' }   // 预置一个演示绑定
// 工人身份码 ticket（机制1：工人亮码，管理员扫）→ 一次性、10 分钟过期
const bindTickets = {}                        // ticket → { openid, exp, used }，短生命周期不落盘
// 工人绑定码防伪 key（机制2：管理员发码，工人扫）→ 可重发、可作废
const bindKeys = store.bindKeys || {}         // worker_id → key
// 超纲问题待审队列（答疑铁律的转人工出口 → 反哺本地库素材）
const pendingQuestions = store.pendingQuestions || []

const randKey = () => Math.random().toString(36).slice(2, 8)
const keyFor = wid => bindKeys[wid] || (bindKeys[wid] = randKey())
const TICKET_TTL = 10 * 60 * 1000

function newTicket(openid) {
  // 码面数字部分给管理员手动输入兜底；二维码内容含前缀防误扫
  const t = String(100000 + Math.floor(Math.random() * 900000))
  bindTickets[t] = { openid, exp: Date.now() + TICKET_TTL, used: false }
  return t
}
function takeTicket(t) {
  const tk = bindTickets[t]
  if (!tk || tk.used || tk.exp < Date.now()) return null
  tk.used = true
  return tk
}
// 解析二维码文本：支持 BQ5|B|w001.key 与 wxacode scene w=w001&k=key 两种来源
function parseBindCode(raw) {
  const s = String(raw || '').trim()
  let m = s.match(/^BQ5\|B\|(w\d+)\.([a-z0-9]+)$/i)
  if (m) return { worker_id: m[1], key: m[2] }
  m = s.match(/w=(w\d+)/i)
  const k = s.match(/k=([a-z0-9]+)/i)
  if (m && k) return { worker_id: m[1], key: k[1] }
  return null
}
function parseTicket(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/^BQ5\|T\|(\d{6})$/) || s.match(/^(\d{6})$/)   // 二维码或手输 6 位
  return m ? m[1] : null
}

// openid 解析：真 openid（jscode2session）优先；无 secret/换不出 → dev_id 占位（本机持久随机串）
// dev_id ↔ 真 openid 别名表（随 store 持久化）：真机每次 /api/me（带 code）建立映射后，
// 后续不带 code 的请求（bind/admin 系列）也能认出同一个微信——
// 否则激活存的是真 openid、绑定认的是 dev_id，管理端操作一律 403、绑定关系也落空
const devToOpenid = store.devToOpenid || {}
async function resolveOpenid(data) {
  const real = await wxOpenid(data.code)
  if (real) {
    if (data.dev_id && devToOpenid[data.dev_id] !== real) { devToOpenid[data.dev_id] = real; persist() }
    return real
  }
  if (data.openid) return data.openid
  if (data.dev_id) return devToOpenid[data.dev_id] || data.dev_id
  return data.code ? 'dev-' + String(data.code).slice(0, 20) : ''
}
const isAdmin = oid => adminOpenids.includes(oid)

// 管理端接口统一守卫：非管理员一律拒绝（返回对象=拒绝，null=放行）。
// 契约见 miniprogram/PROTOCOL.md：管理端接口必须服务端按 openid 鉴权，工人调用不得放行。
async function denyUnlessAdmin(data) {
  const oid = await resolveOpenid(data)
  return isAdmin(oid) ? null : { error: 'forbidden: admin only' }
}

// 新建/更新工人（claim 与 workers/save 共用）
function upsertWorker(w) {
  if (w.worker_id) {
    const i = workers.findIndex(x => x.worker_id === w.worker_id)
    if (i < 0) return { error: 'worker not found: ' + w.worker_id }
    const saved = { ...workers[i], ...w, font_size: fontFor(w.age) }
    if (!w.phone) saved.phone = workers[i].phone
    workers[i] = saved
    return { worker: saved }
  }
  const saved = {
    worker_id: 'w' + String(workers.length + 1).padStart(3, '0'),
    name: w.name || '', age: +w.age || 0, years: +w.years || 0,
    job: w.job || '其他', font_size: fontFor(w.age),
    dialect: w.dialect || '普通话',   // ASR 方言模型选择依据（后端按此映射 appkey/model）
    group_id: w.group_id || groups[0].group_id, phone: w.phone || ''
  }
  workers.push(saved)
  return { worker: saved }
}

/* ================= 规范知识库（开发者库雏形；特征函数匹配归编排器） ================= */

const KB = [
  { kb_id: 'kb01', title: '建筑施工高处作业安全技术规范', doc_no: 'JGJ 80-2016', clause: '第4.2.1条', summary: '脚手架连墙件应按两步三跨设置，严禁后补或随意拆除', keywords: ['脚手架', '高处', '连墙件', '外墙'] },
  { kb_id: 'kb02', title: '建筑施工高处作业安全技术规范', doc_no: 'JGJ 80-2016', clause: '第5.1.3条', summary: '作业层外侧应随搭设同步满挂密目式安全网，栏杆高度不低于1.2m', keywords: ['脚手架', '安全网', '栏杆', '高处'] },
  { kb_id: 'kb03', title: '房屋市政工程生产安全重大事故隐患判定标准', doc_no: '建质规〔2022〕2号', clause: '第9条', summary: '模板支架未验收即使用、超载堆放，判定为重大事故隐患', keywords: ['模板', '支设', '支架'] },
  { kb_id: 'kb04', title: '混凝土结构工程施工规范', doc_no: 'GB 50666-2011', clause: '第8.6条', summary: '混凝土浇筑应分层振捣密实，严禁振捣棒直接触碰钢筋与模板', keywords: ['混凝土', '浇筑', '振捣'] },
  { kb_id: 'kb05', title: '建筑施工塔式起重机安装使用拆卸安全技术规程', doc_no: 'JGJ 196-2010', clause: '第4.0.9条', summary: '塔吊顶升作业时严禁下方站人，风力超过4级停止顶升', keywords: ['塔吊', '顶升'] },
  { kb_id: 'kb06', title: '建筑起重机械安全监督管理规定', doc_no: '建设部令第166号', clause: '第12条', summary: '起重吊装执行"十不吊"，指挥信号不明不得起吊', keywords: ['塔吊', '起重', '吊装'] },
  { kb_id: 'kb07', title: '施工现场临时用电安全技术规范', doc_no: 'JGJ 46-2005', clause: '第8.1.3条', summary: '配电实行一机一闸一漏，严禁私拉乱接', keywords: ['用电', '配电', '电工'] },
  { kb_id: 'kb08', title: '建筑施工安全检查标准', doc_no: 'JGJ 59-2011', clause: '第3.11条', summary: '临边洞口必须设置防护栏杆或盖板，并挂安全警示标志', keywords: ['临边', '洞口', '防护', '钢筋'] }
]

/* ================= 推送内容库（标题 + 详细真实推送内容） ================= */

// quiz_expect：判分关键词——外层数组=题号对齐，中层=关键词组（同义词并列），组全中=correct/中部分=partial
// quiz_var：答对后的情景变式追问（测迁移不测背诵），null=不追问
const CONTENT_LIB = [
  { content_id: 'c01', title: '三层外墙脚手架搭设', job_tag: '架子工', kb_ids: ['kb01', 'kb02'],
    points: ['连墙件必须按两步三跨设置，严禁随意拆除', '作业层外侧随搭设同步满挂密目安全网，栏杆不低于1米2', '搭设过程工具入袋、材料不抛掷，防物体打击'],
    quiz: ['连墙件应该按什么间距设置？', '作业层外侧的安全网什么时候挂？'],
    quiz_expect: [[['两步', '二步'], ['三跨', '3跨']], [['同步', '同时', '随'], ['挂', '满挂']]],
    quiz_var: ['如果你上工时发现连墙件被人拆了，该怎么办？', '如果看到安全网破了个洞，要不要换？'] },
  { content_id: 'c02', title: '二层模板支设', job_tag: '木工', kb_ids: ['kb03'],
    points: ['模板支架必须验收合格后方可使用', '支架上严禁超载集中堆放材料', '拆模须申请审批，按顺序拆除'],
    quiz: ['模板支架使用前要做什么？', '支架上能集中堆放材料吗？'],
    quiz_expect: [[['验收']], [['不能', '严禁', '不许', '超载']]],
    quiz_var: ['支架验收单找不到了，今天能不能先用着？', '材料没地方放，临时堆在支架上一会儿行吗？'] },
  { content_id: 'c03', title: '钢筋绑扎', job_tag: '钢筋工', kb_ids: ['kb08'],
    points: ['临边洞口设防护栏杆或盖板，并挂警示标志', '高空绑扎钢筋必须系挂安全带', '钢筋骨架临时固定，防止倾倒'],
    quiz: ['洞口作业该怎么防护？'],
    quiz_expect: [[['盖板', '栏杆', '防护', '警示']]],
    quiz_var: ['看到洞口盖板被人挪开了，你该怎么办？'] },
  { content_id: 'c04', title: '四层混凝土浇筑', job_tag: '混凝土工', kb_ids: ['kb04'],
    points: ['分层浇筑、分层振捣，快插慢拔', '振捣棒严禁直接触碰钢筋与模板', '夜间浇筑照明先行'],
    quiz: ['振捣棒能直接碰钢筋吗？'],
    quiz_expect: [[['不能', '严禁', '不许']]],
    quiz_var: ['赶工来不及了，能不能少振两遍？'] },
  { content_id: 'c05', title: '塔吊顶升作业', job_tag: '塔吊司机', kb_ids: ['kb05', 'kb06'],
    points: ['顶升时严禁下方站人，设置警戒区', '风力超过4级停止顶升作业', '执行"十不吊"，信号不明不起吊'],
    quiz: ['几级风停止顶升？', '什么情况下不许吊？'],
    quiz_expect: [[['4级', '四级', '4', '四']], [['信号', '不明', '十不吊', '指挥']]],
    quiz_var: ['阵风刚停但信号还不太稳，能不能起吊？', '指挥用方言喊你听不清，吊不吊？'] },
  { content_id: 'c06', title: '临边防护搭设', job_tag: '架子工', kb_ids: ['kb08'],
    points: ['临边必须设防护栏杆，高度不低于1米2', '栏杆挂密目网并设挡脚板', '每日巡查防护是否被拆动'],
    quiz: ['临边防护栏杆最低多高？'],
    quiz_expect: [[['1.2', '一米二', '1米2', '一点二']]],
    quiz_var: ['栏杆只有一米高，差一点，行不行？'] },
  { content_id: 'c07', title: '临时用电作业', job_tag: '电工', kb_ids: ['kb07'],
    points: ['一机一闸一漏，严禁私拉乱接', '配电箱上锁并挂警示牌', '湿手不碰开关，停电挂牌检修'],
    quiz: ['配电箱能不能私拉乱接？'],
    quiz_expect: [[['不能', '严禁', '一机一闸', '私拉']]],
    quiz_var: ['电箱锁坏了，临时拉根线充电行不行？'] }
]

/* ---------- 剧本生成（管线B桩版：推送即生成——管理员一推送就出新剧本，不等定时批量；LLM 就位前由内容库+档案拼装） ---------- */

// 今日任务对应的内容条目：LLM 剧本优先（draft.content）→ 标题精确匹配 → kb_ids 重叠 → 兜底第一条
function todayContent() {
  if (todayTask.draft && todayTask.draft.content) return todayTask.draft.content
  return CONTENT_LIB.find(c => c.title === todayTask.task_text)
    || CONTENT_LIB.find(c => c.kb_ids.some(id => (todayTask.kb_ids || []).includes(id)))
    || CONTENT_LIB[0]
}

// 当日命中集 = 今日任务关联规范条目（答疑锚定铁律的知识边界，随 session 存留）
// 显式 kb_ids 优先；管理员自定义工序（未选条文）→ 确定性层特征打分圈定
function ragHits() {
  if ((todayTask.kb_ids || []).length) {
    return todayTask.kb_ids.map(id => KB.find(k => k.kb_id === id)).filter(Boolean)
  }
  return kbSearchItems(todayTask.task_text || '')
}

// 推送即生成：/api/tasks 一推送立刻按新工序出剧本草稿（trace 留痕，generated_at=推送时刻），随 todayTask 存档
// LLM 生成（§7 导向声明）优先；未配 key / 失败 / 输出非法 → 内容库+档案拼装兜底（降级不断链）
async function generateDraft() {
  const hits = ragHits()
  if (llmReady()) {
    try {
      const weak = (masteryFor((workers[0] || {}).worker_id || 'w001')[0] || {}).point || ''
      const script = await scriptWithLLM(todayTask.task_text, hits, weak)
      const content = {
        content_id: 'llm-' + todayTask.task_id, title: todayTask.task_text, job_tag: 'AI 解析',
        points: script.points, quiz: script.quiz.map(q => q.q),
        quiz_expect: script.quiz.map(q => q.expect), quiz_var: script.quiz.map(q => q.var_q)
      }
      const draft = {
        date: todayTask.date, task_text: todayTask.task_text, generated_at: nowHM(), source: 'llm',
        content,
        point_count: content.points.length, quiz_count: content.quiz.length,
        rag_hits: hits.map(k => k.kb_id),
        trace: [
          { role: '工序解析', task_text: todayTask.task_text, algo: 'LLM 工序解析（特征函数）' },
          { role: '规范检索', items: hits.map(k => `${k.doc_no} ${k.clause}`) },
          { role: '内容生成', algo: 'LLM 剧本生成（推送即生成）', generated_at: nowHM() }
        ]
      }
      todayTask.draft = draft
      return draft
    } catch (e) {
      console.log('scriptWithLLM 回落内容库拼装:', e && e.message)
    }
  }
  const content = todayContent()
  const draft = {
    date: todayTask.date,
    task_text: todayTask.task_text,
    generated_at: nowHM(),
    content_id: content.content_id,
    point_count: content.points.length,
    quiz_count: content.quiz.length,
    rag_hits: hits.map(k => k.kb_id),
    trace: [
      { role: '工序解析', task_text: todayTask.task_text, job_tag: content.job_tag },
      { role: '规范检索', items: hits.map(k => `${k.doc_no} ${k.clause}`) },
      { role: '内容生成', algo: '内容库+档案拼装（LLM 就位前）', generated_at: nowHM() }
    ]
  }
  todayTask.draft = draft
  return draft
}

// 按工人档案个性化生成剧本：点名 + 薄弱点提醒 + 内容库点位 + 考题（带判分关键词/变式追问）
function buildSteps(worker, content) {
  const mastery = masteryFor(worker.worker_id)
  const weak = mastery[0]   // 掌握度排序后第一个 = 最薄弱
  const steps = [
    { id: 's0', type: 'say', text: `${worker.name}师傅，早上好。今日学习：${content.title}。`, voice: { speed: 0.95, tone: 'steady' } }
  ]
  if (weak && weak.value < 80) {
    steps.push({ id: 's-w', type: 'say', text: `上次「${weak.point}」您答得不完整，今天重点过一遍。` })
  }
  content.points.forEach((p, i) => {
    steps.push({ id: 's' + (i + 1), type: 'say', text: `第${CN_NUM[i] || (i + 1)}，${String(p).replace(/[。！？；，、\s]+$/, '')}。` })
  })
  content.quiz.forEach((q, i) => {
    steps.push({
      id: 'q' + (i + 1), type: 'ask', text: `问题${CN_NUM[i]}，${q}`,
      listen: { timeout_ms: 30000 },
      expect: (content.quiz_expect || [])[i] || [],   // 判分关键词组（前端忽略此字段）
      var_q: (content.quiz_var || [])[i] || null      // 答对后的情景变式追问
    })
  })
  return steps
}

// 判分（判分特征函数的工程化占位）：expect 关键词组命中率 → correct/partial/wrong/unknown
function scoreAnswer(step, text) {
  const groups = (step && step.expect) || []
  const t = String(text || '').trim()
  if (!t || t.length < 2) return 'unknown'      // 空白/单字噪音（嗯啊呃）→ unknown：听不清不冤枉工人
  if (!groups.length) return 'partial'
  const hit = groups.filter(g => g.some(k => t.includes(k))).length
  if (hit >= groups.length) return 'correct'
  return hit > 0 ? 'partial' : 'wrong'
}

/* ================= 工具 ================= */

function json(res, obj, code = 200) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

// 指令关键词匹配（真路径=录音上传→ASR→小模型意图分类，这里先用文本/桩）
function matchCommand(t) {
  if (/大点声|音量大|大声/.test(t)) return { action: 'set_volume', direction: 'up', echo: t }
  if (/小点声|音量小|小声/.test(t)) return { action: 'set_volume', direction: 'down', echo: t }
  if (/字体?大|看不清/.test(t))      return { action: 'set_font', direction: 'up', echo: t }
  if (/字体?小/.test(t))             return { action: 'set_font', direction: 'down', echo: t }
  if (/暂停|停一下|等一下/.test(t))  return { action: 'pause', echo: t }
  if (/继续|接着|开始/.test(t))      return { action: 'resume', echo: t }
  if (/再说|重复|重来|没听清/.test(t)) return { action: 'repeat', echo: t }
  if (/不懂|没听懂|啥意思|什么意思|为啥|为什么|咋回事|问/.test(t)) return { action: 'ask', echo: t }
  if (/跳过|下一句|快进/.test(t))    return { action: 'next', echo: t }
  return { action: 'none', echo: t }
}

// 字号规则：年龄决定，只大不小
const fontFor = age => (+age >= 50) ? 'xxl' : (+age >= 40 ? 'xl' : 'l')

const dateStr = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const nowHM = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------- 确定性伪随机（FNV-1a，与 mock 同算法） ---------- */
function hash(s) {
  let h = 2166136261
  s = String(s)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}
const seeded = s => hash(s) / 4294967296   // 0..1

/* ================= 今日任务 ================= */

let todayTask = store.todayTask || {
  task_id: 'task-001',
  date: dateStr(),
  task_text: '三层外墙脚手架搭设',
  note: '连墙件、安全网是今天重点',
  kb_ids: ['kb01', 'kb02'],
  pushed_by: '班组长-刘志强',
  pushed_at: '06:30',
  target: 'all'
}

/* ================= 看板 / 详情 数据生成 ================= */

const TASK_POOL = ['三层外墙脚手架搭设', '二层模板支设', '钢筋绑扎', '四层混凝土浇筑', '塔吊顶升作业', '临边防护搭设']
const POINTS = ['连墙件设置要求', '安全网张挂时机', '洞口临边防护', '临时用电规范', '起重吊装十不吊', '脚手架验收流程', '个人防护用品佩戴', '动火作业审批']
const WRONG_POOL = [
  { q: '连墙件应该按什么间距设置？', your: '缺了后补就行', correct: '两步三跨设置，严禁随意拆除' },
  { q: '作业层外侧安全网什么时候挂？', your: '干完再挂', correct: '随搭设同步满挂' },
  { q: '洞口作业该怎么防护？', your: '放块木板就行', correct: '设盖板或防护栏杆，并挂安全网' },
  { q: '什么情况下起重吊装不许吊？', your: '看不清也能吊', correct: '指挥信号不明不吊（十不吊）' },
  { q: '配电箱能不能私拉乱接？', your: '临时用一下没事', correct: '严禁私拉乱接，一机一闸一漏' }
]

function workerDayStatus(w, date) {
  const done = seeded(w.worker_id + '|' + date) < 0.72
  if (!done) return { worker_id: w.worker_id, name: w.name, job: w.job, group_id: w.group_id, status: 'pending', score: null, finished_at: null }
  const score = 60 + Math.floor(seeded(date + '|' + w.worker_id) * 39)
  const minutes = 30 + Math.floor(seeded('t|' + w.worker_id + '|' + date) * 55)
  const hh = String(6 + Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return { worker_id: w.worker_id, name: w.name, job: w.job, group_id: w.group_id, status: 'done', score, finished_at: `${hh}:${mm}` }
}

function overviewFor(date) {
  const list = workers.map(w => workerDayStatus(w, date))
  const done = list.filter(w => w.status === 'done')
  const yDone = workers.filter(w => workerDayStatus(w, dateStr(-1)).status === 'done').length
  return {
    date,
    task: date === dateStr() ? todayTask : {
      task_id: 'task-y001', date, task_text: TASK_POOL[hash(date) % TASK_POOL.length],
      note: '', kb_ids: [], pushed_by: '班组长-刘志强', pushed_at: '06:28', target: 'all'
    },
    stats: {
      total: list.length,
      done: done.length,
      avg_score: done.length ? Math.round(done.reduce((s, w) => s + w.score, 0) / done.length) : 0,
      done_diff: date === dateStr() ? done.length - yDone : 0
    },
    workers: list
  }
}

function masteryFor(workerId) {
  const n = 3 + Math.floor(seeded(workerId + '|mp') * 3)
  const start = Math.floor(seeded(workerId + '|ms') * POINTS.length)
  const list = []
  for (let i = 0; i < n; i++) {
    const point = POINTS[(start + i * 2) % POINTS.length]
    if (list.some(x => x.point === point)) continue
    const value = 55 + Math.floor(seeded(workerId + '|mv' + i) * 44)
    list.push({ point, value, status: value >= 80 ? '已达标' : '待巩固' })
  }
  return list.sort((a, b) => a.value - b.value)
}

function recordsFor(workerId) {
  const n = 3 + Math.floor(seeded(workerId + '|n') * 3)
  const records = []
  for (let i = 0; i < n; i++) {
    const dayOff = -(1 + i * 2 + Math.floor(seeded(workerId + '|d' + i) * 2))
    const wrongCount = Math.floor(seeded(workerId + '|w' + i) * 3)
    const wrongs = []
    for (let j = 0; j < wrongCount; j++) {
      wrongs.push(WRONG_POOL[Math.floor(seeded(workerId + '|wp' + i + '|' + j) * WRONG_POOL.length)])
    }
    records.push({
      date: dateStr(dayOff).slice(5),
      full_date: dateStr(dayOff),
      task_text: TASK_POOL[Math.floor(seeded(workerId + '|t' + i) * TASK_POOL.length)],
      score: 55 + Math.floor(seeded(workerId + '|s' + i) * 45),
      wrong_count: wrongCount,
      wrongs
    })
  }
  const reviewOff = -3 + Math.floor(seeded(workerId + '|r') * 10)
  return { records, next_review_date: dateStr(reviewOff) }
}

/* ================= AI 每日剧本（升级1：内容现做） ================= */

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八']

function draftFor(content) {
  const t = dateStr()
  const key = content.title.replace(/(搭设|支设|绑扎|浇筑|作业)$/, '')
  const evidences = []
  for (const w of workers) {
    const mastery = masteryFor(w.worker_id)
    const hit = mastery.find(m => {
      const mk = m.point.replace(/(设置要求|张挂时机|防护|规范|流程|佩戴|审批|十不吊)$/, '')
      return key.includes(mk) || mk.includes(key.slice(0, 2)) ||
        content.kb_ids.some(id => {
          const k = KB.find(x => x.kb_id === id)
          return k && (k.summary.includes(mk) || k.keywords.some(kw => m.point.includes(kw)))
        })
    })
    if (hit && hit.value < 85) {   // 只引低分证据，诊断才立得住
      evidences.push({ worker: w.name, point: hit.point, value: hit.value })
      if (evidences.length >= 2) break
    }
  }
  return {
    date: t,
    generated_at: nowHM(),
    steps: [
      { id: 's0', type: 'say', text: `今日学习：${content.title}。`, voice: { speed: 0.95, tone: 'steady' } },
      ...content.points.map((p, i) => ({ id: 's' + (i + 1), type: 'say', text: `第${CN_NUM[i]}，${p}。` })),
      ...content.quiz.map((q, i) => ({ id: 'q' + (i + 1), type: 'ask', text: `问题${CN_NUM[i]}，${q}`, listen: { timeout_ms: 30000 } }))
    ],
    trace: [
      { role: '工序解析', task_text: content.title, job_tag: content.job_tag },
      { role: '规范检索', items: content.kb.map(k => `${k.doc_no} ${k.clause}`) },
      { role: '学情诊断', evidences },
      { role: '内容生成', algo: 'LLM 剧本生成（推送即生成）', generated_at: nowHM() }
    ]
  }
}

/* ================= 推送记录 ================= */

function targetDesc(target) {
  if (target === 'all') return '全部工人'
  if (target.startsWith('worker:')) {
    const w = workers.find(x => x.worker_id === target.slice(7))
    return w ? w.name : target
  }
  if (target.startsWith('group:')) return groupName(target.slice(6))
  return target
}

const pushRecords = store.pushRecords || [
  { task_id: 'task-001', date: dateStr(), pushed_at: '06:30', task_text: '三层外墙脚手架搭设', note: '连墙件、安全网是今天重点', kb_ids: ['kb01', 'kb02'], target: 'all', target_desc: '全部工人', target_count: 12, pushed_by: '班组长-刘志强' },
  { task_id: 'task-y001', date: dateStr(-1), pushed_at: '06:28', task_text: '二层模板支设', note: '', kb_ids: ['kb03'], target: 'all', target_desc: '全部工人', target_count: 12, pushed_by: '班组长-刘志强' },
  { task_id: 'task-y002', date: dateStr(-2), pushed_at: '06:35', task_text: '塔吊顶升作业', note: '顶升时严禁下方站人', kb_ids: ['kb05', 'kb06'], target: 'group:g3', target_desc: '塔吊组', target_count: 3, pushed_by: '班组长-刘志强' }
]

/* ================= 路由 ================= */

const routes = {
  '/api/workers': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    return {
      workers: workers.map(w => ({ ...w, phone: undefined, phone_masked: maskPhone(w.phone), group_name: groupName(w.group_id) }))
    }
  },

  '/api/groups': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    return { groups: groups.map(g => ({ ...g, count: workers.filter(w => w.group_id === g.group_id).length })) }
  },

  '/api/groups/save': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    if (!data.name || !String(data.name).trim()) return { error: '组名不能为空' }
    const g = { group_id: 'g' + (groups.length + 1), name: String(data.name).trim().slice(0, 12) }
    groups.push(g)
    persist()
    return { ok: true, group: g }
  },

  '/api/content/list': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    return {
      items: CONTENT_LIB.map(c => {
        const withKb = {
          ...c,
          kb: c.kb_ids.map(id => KB.find(k => k.kb_id === id)).filter(Boolean)
        }
        return { ...withKb, draft: draftFor(withKb) }
      })
    }
  },

  '/api/kb/search': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    const q = String(data.query || '').trim()
    if (!q) return { items: [] }
    const items = KB.map(k => {
      let score = 0
      for (const kw of k.keywords) if (q.includes(kw)) score += 32
      for (const ch of q) if (/[一-龥]/.test(ch) && (k.summary.includes(ch) || k.title.includes(ch))) score += 1
      return { ...k, score: Math.min(99, score) }
    }).filter(k => k.score > 3).sort((a, b) => b.score - a.score).slice(0, 5)
    return { items: items.length ? items : KB.slice(0, 3).map(k => ({ ...k, score: 75 })) }
  },

  // 今日会话：按工人档案生成个性化剧本 + 预挂音频 + 命中集入会话（答疑锚定用）
  '/api/session/today': async data => {
    const w = workers.find(x => x.worker_id === data.worker_id) || workers[0]
    const content = todayContent()
    const steps = await withAudio(buildSteps(w, content))
    const hits = ragHits()
    const sid = 'sess-' + Date.now().toString(36)
    sessions[sid] = { session_id: sid, worker_id: w.worker_id, date: dateStr(), steps, rag_hits: hits, answers: {}, created: Date.now() }
    return {
      session_id: sid,
      worker: w,
      task_text: todayTask.task_text,
      steps,
      trace: [
        { role: '工序解析', task_text: todayTask.task_text, job_tag: content.job_tag },
        { role: '规范检索', items: hits.map(k => `${k.doc_no} ${k.clause}`) },
        { role: '学情诊断', worker: w.name, weakest: (masteryFor(w.worker_id)[0] || {}).point },
        { role: '内容生成', algo: todayTask.draft && todayTask.draft.source === 'llm' ? 'LLM 剧本生成（推送即生成）' : '内容库+档案拼装（LLM 就位前）', generated_at: (todayTask.draft || {}).generated_at || nowHM() }
      ]
    }
  },

  // 判分：session 里查 step.expect 关键词组；追问按定稿——correct→变式 / partial→点拨重答 /
  // wrong→先挖一层（不给答案，二次错才给答案收束）/ unknown→不追问待复核
  '/api/answer': async data => {
    const t = String(data.answer_text || '')
    const sess = sessions[data.session_id]
    // step 查找：原题 id 直接用；追问/变式步（-re/-var）回溯原题（expect 判分组挂在原题上）
    const step = sess && (sess.steps.find(s => s.id === data.step_id)
      || sess.steps.find(s => s.id === data.step_id.replace(/-(re|var)$/, '')))
    const question = step ? step.text.replace(/^问题[一二三四五]，/, '') : '刚才的问题'

    // 判分来源：LLM 判分 agent（特征函数 v1）优先；LLM 未配/失败/输出非法 → 关键词桩兜底（降级不断链）
    let ai = null
    if (t && step && llmReady()) {
      try { ai = await gradeWithLLM(question, (step && step.expect) || [], (sess && sess.rag_hits) || ragHits(), t) }
      catch (e) { console.log('gradeWithLLM 回落桩判分:', e && e.message) }
    }
    const verdict = ai ? ai.verdict : scoreAnswer(step, t)
    const aiReason = ai && ai.reason ? ai.reason : ''
    const origId = data.step_id.replace(/-(re|var)$/, '')
    if (ai && ai.red_flag && sess) { (sess.redFlags = sess.redFlags || {})[origId] = true }   // 自信错顶格，学情急迫度拉满

    // 情景变式步（-var）：答完即止（迁移检测，不参与计分）
    if (/-var$/.test(data.step_id)) {
      const v = verdict === 'correct' ? 'correct' : 'partial'
      return { verdict: v, next_steps: await withAudio([{ id: data.step_id + '-end', type: 'say', text: v === 'correct' ? '对，就是这个理。' : '已记录，继续。' }]) }
    }

    // 重问步（-re）：记录真实 verdict——扶助对与二次错的分水岭
    if (/-re$/.test(data.step_id)) {
      if (verdict === 'wrong') {
        // 二次错 → -fix 只给答案，不加因果钩子，不再追问（收束）
        if (sess) sess.answers[origId] = 'wrong'
        const ref = step && sess && sess.rag_hits[0]
        const right = ref ? `${ref.doc_no}${ref.clause}：${ref.summary}` : '刚才讲过的要点'
        return { verdict, next_steps: await withAudio([{ id: data.step_id + '-fix', type: 'say', text: '记住了——' + right }]) }
      }
      // 扶助后答对 → assisted_correct（学情内部档：权重介于 correct 与 partial；契约 verdict 枚举不变，仍返 correct）
      if (sess && verdict === 'correct') { sess.answers[origId] = 'correct'; (sess.assisted = sess.assisted || {})[origId] = true }
      else if (sess) sess.answers[origId] = sess.answers[origId] || verdict
      return { verdict, next_steps: await withAudio([{ id: data.step_id + '-end', type: 'say', text: verdict === 'correct' ? '对，这次说全了。' : '已记录，继续。' }]) }
    }

    // 首答
    if (sess) sess.answers[data.step_id] = verdict
    const next = []
    if (verdict === 'correct') {
      next.push({ id: data.step_id + '-ok', type: 'say', text: '回答正确。' })
      if (step && step.var_q) {          // 答对 → 情景变式追问（测迁移，不测背诵）
        next.push({ id: data.step_id + '-var', type: 'ask', text: '再问一句：' + step.var_q, listen: { timeout_ms: 30000 } })
      }
    } else if (verdict === 'partial') {
      next.push({ id: data.step_id + '-hint', type: 'say', text: aiReason || '接近了，但还不完整。再想想，把要点说全。' })
      next.push({ id: data.step_id + '-re', type: 'ask', text: '完整说一遍：' + question, listen: { timeout_ms: 30000 } })
    } else if (verdict === 'unknown') {
      // 听不清/无关答 → 不追问、不冤枉（判分导向声明：宁 unknown 不 wrong），记待人工复核
      if (sess) { sess.pendingReview = sess.pendingReview || []; sess.pendingReview.push({ step_id: data.step_id, at: Date.now() }) }
      next.push({ id: data.step_id + '-skip', type: 'say', text: '这句没听清，不勉强，先继续。回头班组长再跟你对一遍。' })
    } else {   // wrong → 先挖一层：不给答案，先让他再试一次
      next.push({ id: data.step_id + '-dig', type: 'say', text: '再想想——别急着放弃，工地上这个事每天都能看见。' })
      next.push({ id: data.step_id + '-re', type: 'ask', text: '再试一次：' + question, listen: { timeout_ms: 30000 } })
    }
    return { verdict, next_steps: await withAudio(next) }
  },

  // 会话结束：真实算分（correct=100/partial=60/wrong=20 平均）+ SM-2 简化排期
  '/api/session/finish': data => {
    const sess = sessions[data.session_id]
    const qIds = sess ? sess.steps.filter(s => s.type === 'ask').map(s => s.id) : []
    const verdicts = qIds.map(id => sess.answers[id]).filter(v => ['correct', 'partial', 'wrong'].includes(v))
    const valOf = id => {
      const v = sess.answers[id]
      // assisted_correct（扶助对，被点拨后答对）：权重介于 correct(100) 与 partial(60) 之间取 80
      if (v === 'correct') return (sess.assisted || {})[id] ? 80 : 100
      return v === 'partial' ? 60 : 20
    }
    const score = verdicts.length
      ? Math.round(qIds.filter(id => verdicts.includes(sess.answers[id])).reduce((s, id) => s + valOf(id), 0) / verdicts.length)
      : 60
    const days = score >= 85 ? 4 : score >= 60 ? 2 : 1   // SM-2 简化：分数定复训间隔
    const wrong_items = sess ? sess.steps
      .filter(s => s.type === 'ask' && ['wrong', 'partial'].includes(sess.answers[s.id]))
      .map(s => ({ q_id: s.id, q: s.text.replace(/^问题[一二三四五]，/, ''), your: data.events && '见录音', correct: (s.expect || []).flat().slice(0, 2).join('、') }))
      : []
    const mastery_update = {}
    if (sess) qIds.forEach((id, i) => {
      const s = sess.steps.find(x => x.id === id)
      if (s) mastery_update[s.text.replace(/^问题[一二三四五]，/, '').slice(0, 12)] =
        sess.answers[id] === 'correct' ? '已达标' : '待巩固'
    })
    return {
      score, wrong_items, mastery_update,
      next_review_date: dateStr(days),
      received_events: (data.events || []).length,
      trace: [
        { role: '考评', score, answered: verdicts.length, total: qIds.length },
        { role: '复训调度', next: dateStr(days), algo: 'SM-2简化' },
        { role: '行为诊断', events: (data.events || []).length }
      ]
    }
  },

  // 一句话识别：wav 原始字节 → 文字。dialect 按当前 openid 绑定的工人档案取
  '/api/asr': async (data, isJson, raw) => {
    if (isJson) return { error: 'expect wav body' }
    const oid = await resolveOpenid(data)
    const w = oid && workers.find(x => x.worker_id === openidBinds[oid])
    const text = await nlsAsr(raw, w && w.dialect)
    return { text: text || '', dialect: (w && w.dialect) || '普通话' }
  },

  /* ---------- 工人打断提问（答疑锚定铁律：只在当日命中集里找答案，超纲转人工） ---------- */
  '/api/ask': async data => {
    const q = String(data.question || '')
    const sess = sessions[data.session_id]
    const hits = (sess && sess.rag_hits && sess.rag_hits.length) ? sess.rag_hits : ragHits()

    // 短到不构成问题（空/单字噪音）→ 固定"没听清"，不打扰答疑 agent 与待办队列
    if (q.trim().length < 2) {
      const shortSteps = await withAudio([{ id: 'qa-' + Date.now().toString(36), type: 'say', text: '这句没听清，大点声再问一次。', voice: { tone: 'teacher' } }])
      return { question: q, steps: shortSteps, replay_current: true, drop_rest: false }
    }
    // 答疑 agent（LLM，命中集锚定）；失败/未配 → 关键词模板桩兜底
    let text = ''
    let hazardDesc = ''
    if (q && llmReady()) {
      try {
        const cur = sess && sess.steps.find(s => s.id === data.step_id)
        const ai = await askWithLLM(q, hits, cur ? cur.text : '')
        if (ai.in_hits && ai.answer) text = ai.answer
        if (ai.hazard_flag) hazardDesc = ai.hazard_desc || q
      } catch (e) { console.log('askWithLLM 回落桩答疑:', e && e.message) }
    }

    if (!text) {
      // 命中集内按关键词重叠找最贴规范条目（RAG 打分同构；答疑桩兜底）
      let best = null, bestScore = 0
      for (const k of hits) {
        let s = 0
        for (const kw of k.keywords) if (q.includes(kw)) s += 30
        for (const ch of q) if (/[一-龥]/.test(ch) && (k.summary.includes(ch) || k.title.includes(ch))) s += 1
        if (s > bestScore) { bestScore = s; best = k }
      }
      if (best && bestScore >= 8) {
        text = `规范上是这样说的：${best.doc_no}${best.clause}，${best.summary}。这条必须照做，别糊弄。`
      } else {
        // 超纲：不编造，转人工 + 记待审队列（反哺本地库素材）
        pendingQuestions.push({ session_id: data.session_id, step_id: data.step_id, question: q, at: new Date().toISOString() })
        store.pendingQuestions = pendingQuestions
        saveStore()
        text = '这个超出今天讲的范围了，得问你们安全员。我已经记下来了，回头给你补上。'
      }
    }
    // 隐患上报（hazard_flag）：落待办直达管理端——AI 只记录上报，处置权归管理员
    if (hazardDesc) {
      pendingQuestions.push({ type: 'hazard', session_id: data.session_id, step_id: data.step_id, question: q, hazard_desc: hazardDesc, at: new Date().toISOString() })
      store.pendingQuestions = pendingQuestions
      saveStore()
    }
    const steps = await withAudio([{ id: 'qa-' + Date.now().toString(36), type: 'say', text, voice: { tone: 'teacher' } }])
    return { question: q, steps, replay_current: true, drop_rest: false }
  },

  // TTS 合成：{text} → {audio_url:'/tts/x.mp3'}。编排器生成剧本时可预合成塞进 say.audio_url
  '/api/tts': async data => {
    const url = await nlsTts(data.text)
    if (!url) return { error: 'tts 不可用：检查 ALI_AK_ID/ALI_AK_SECRET/NLS_APPKEY' }
    return { audio_url: url }
  },

  // 指令：文本直接匹配；音频 → 真 ASR 转文字再匹配（识别不出来时 none）
  '/api/command': async (data, isJson, raw) => {
    if (isJson) return matchCommand(data.text || '')
    const text = await nlsAsr(raw, '普通话')   // 指令统一普通话模型，减少方言误触发
    return matchCommand(text || '')
  },

  /* ================= 管理员端（桩；正式环境按 openid 鉴权 + 数据库持久化） ================= */

  '/api/me': async data => {
    const oid = await resolveOpenid(data)
    const wid = openidBinds[oid]
    const w = wid && workers.find(x => x.worker_id === wid)
    // 双重身份：既是管理员又绑了工人档案 → role 仍 admin（管理端照进），但 worker 一并下发——
    // 前端「码>身份」路由：扫门口码时拿 worker 直接进学习流，直接打开/扫管理员码时进管理端
    if (isAdmin(oid)) {
      return w
        ? { openid: oid, role: 'admin', name: '班组长-刘志强', worker: w }
        : { openid: oid, role: 'admin', name: '班组长-刘志强' }
    }
    if (w) return { openid: oid, role: 'worker', worker: w }
    // 无档案 → 未绑定：前端跳 pages/bind/bind 亮身份码或扫管理员码
    return { openid: oid, role: 'worker', worker: null, need_bind: true }
  },

  /* ---------- 机制1：工人亮身份码，管理员扫 → 认领 ---------- */
  // 工人端：刷出本机身份码（10 分钟、一次性、可重复刷新重发）
  '/api/bind/ticket': async data => {
    const oid = await resolveOpenid(data)
    if (!oid) return { error: 'no openid' }
    if (openidBinds[oid]) {
      const w = workers.find(x => x.worker_id === openidBinds[oid])
      return { bound: true, worker: w }
    }
    // 有未过期未用的 ticket 直接复用——前端轮询时码面稳定，管理员扫到不会因刷新失效
    for (const [t, tk] of Object.entries(bindTickets)) {
      if (tk.openid === oid && !tk.used && tk.exp > Date.now()) {
        return { bound: false, ticket: t, qr_text: 'BQ5|T|' + t, manual_code: t,
                 expires_in: Math.round((tk.exp - Date.now()) / 1000) }
      }
    }
    const t = newTicket(oid)
    return { bound: false, ticket: t, qr_text: 'BQ5|T|' + t, manual_code: t, expires_in: TICKET_TTL / 1000 }
  },

  // 管理端：扫到/手输 ticket → 认领；worker_id=绑已有档案，否则携带 worker 表单新建
  '/api/bind/claim': async data => {
    const oid = await resolveOpenid(data)
    if (!isAdmin(oid)) return { error: 'forbidden: admin only' }
    const t = parseTicket(data.ticket || data.qr_text)
    const tk = t && takeTicket(t)
    if (!tk) return { error: '绑定码无效或已过期，请让工人刷新二维码' }
    let wid = data.worker_id
    if (!wid) {
      const r = upsertWorker(data.worker || {})
      if (r.error) return r
      wid = r.worker.worker_id
    }
    openidBinds[tk.openid] = wid
    persist()
    const w = workers.find(x => x.worker_id === wid)
    return { ok: true, worker: { ...w, phone: undefined, phone_masked: maskPhone(w.phone) } }
  },

  /* ---------- 机制2：管理员发码，工人扫 → 自绑 ---------- */
  // 管理端：为工人生成/重发绑定码（regenerate=true 作废旧码）
  '/api/bind/code': async data => {
    const oid = await resolveOpenid(data)
    if (!isAdmin(oid)) return { error: 'forbidden: admin only' }
    const wid = data.worker_id
    if (!workers.find(x => x.worker_id === wid)) return { error: 'worker not found' }
    if (data.regenerate || !bindKeys[wid]) { bindKeys[wid] = randKey(); persist() }
    const scene = `w=${wid}&k=${bindKeys[wid]}`
    return {
      worker_id: wid,
      key: bindKeys[wid],
      qr_text: `BQ5|B|${wid}.${bindKeys[wid]}`,
      scene,
      // 配了 WX_APPID/WX_SECRET → 返回正式小程序码图路径（nginx /codes/ 服务）；没配 → null，前端画文本码
      wxacode_url: await wxacodeImage(scene)
    }
  },

  // 工人端：扫管理员码（app 内 wx.scanCode 或微信扫一扫 scene 进入）→ 自绑
  '/api/bind/resolve': async data => {
    const oid = await resolveOpenid(data)
    if (!oid) return { error: 'no openid' }
    const b = parseBindCode(data.code || data.scene)
    if (!b) return { error: '无法识别的绑定码' }
    if (bindKeys[b.worker_id] !== b.key) return { error: '绑定码已失效，请联系班组长重发' }
    openidBinds[oid] = b.worker_id
    persist()
    const w = workers.find(x => x.worker_id === b.worker_id)
    return { ok: true, worker: w }
  },

  // 管理员激活：管理员码 scene 里带 k=ADMIN_QR_KEY → 扫码即激活（码即凭证，无需口令）
  '/api/admin/activate': async data => {
    const oid = await resolveOpenid(data)
    if (!oid) return { error: 'no openid' }
    if (isAdmin(oid)) return { ok: true, role: 'admin' }
    if (String(data.qr_key || '') !== ADMIN_QR_KEY) return { error: '管理员码无效，请扫描班组长专用二维码' }
    adminOpenids.push(oid)
    persist()
    return { ok: true, role: 'admin', name: '班组长-刘志强' }
  },

  // 小程序码图片：admin 可调，生成指定 scene 的正式小程序码（门口码 r=gate / 管理员码 r=admin）
  '/api/wxacode': async data => {
    const oid = await resolveOpenid(data)
    if (!isAdmin(oid)) return { error: 'forbidden: admin only' }
    const url = await wxacodeImage(data.scene || 'r=gate', data.page)
    if (!url) return { error: 'wxacode 不可用：检查 WX_APPID/WX_SECRET 与 IP 白名单' }
    return { scene: data.scene, image_url: url }
  },

  // 工作环境天气：{ lat, lng }（wgs84，小程序 wx.getLocation 取得）→ 实时天气 + 作业风险提示
  // 公开端点不鉴权（公开气象数据，网格缓存控量）；Key 只在后端；任何失败桩兜底不断链
  '/api/weather': async data => {
    const lat = parseFloat(data.lat), lng = parseFloat(data.lng)
    if (!isFinite(lat) || !isFinite(lng)) return { error: 'lat/lng required（wgs84）' }
    return { ok: true, lat, lng, weather: await fetchWeather(lat, lng) }
  },

  '/api/tasks/list': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    return {
      items: pushRecords.map(r => ({
        ...r,
        kb: (r.kb_ids || []).map(id => KB.find(k => k.kb_id === id)).filter(Boolean)
      }))
    }
  },

  // AI 预测推荐（规则引擎桩：复训逾期 × 薄弱点 × 内容匹配；真模型归编排器）
  '/api/ai/recommend': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    const t = dateStr()
    const overdue = []
    for (const w of workers) {
      const { next_review_date } = recordsFor(w.worker_id)
      if (next_review_date <= t) {
        const mastery = masteryFor(w.worker_id)
        const days = Math.round((new Date(t) - new Date(next_review_date)) / 86400000)
        overdue.push({ w, point: mastery[0].point, value: mastery[0].value, days })
      }
    }
    const items = []
    if (overdue.length) {
      const byPoint = {}
      overdue.forEach(o => { (byPoint[o.point] = byPoint[o.point] || []).push(o) })
      const sorted = Object.entries(byPoint).sort((a, b) => b[1].length - a[1].length).slice(0, 2)
      for (const [point, list] of sorted) {
        const key = point.replace(/(设置要求|张挂时机|防护|规范|流程|佩戴|审批|十不吊)$/, '')
        const content = CONTENT_LIB.find(c =>
          c.title.includes(key) || c.points.some(p => p.includes(key)) ||
          c.kb_ids.some(id => {
            const k = KB.find(x => x.kb_id === id)
            return k && (k.summary.includes(key) || k.keywords.some(kw => point.includes(kw)))
          })
        )
        const gids = [...new Set(list.map(o => o.w.group_id))]
        let target, target_desc
        if (list.length === 1) { target = 'worker:' + list[0].w.worker_id; target_desc = list[0].w.name }
        else if (gids.length === 1) { target = 'group:' + gids[0]; target_desc = groupName(gids[0]) }
        else { target = 'all'; target_desc = '全部工人' }
        const names = list.map(o => o.w.name).slice(0, 2).join('、')
        const minV = Math.min(...list.map(o => o.value))
        const maxD = Math.max(...list.map(o => o.days))
        items.push({
          rec_id: 'rec-' + point,
          title: content ? content.title : point + '专题巩固',
          content_id: content ? content.content_id : null,
          kb_ids: content ? content.kb_ids : [],
          target, target_desc,
          reason: `「${point}」掌握度待巩固（${minV}%），${names} 复训已逾期 ${maxD} 天`,
          level: 'high'
        })
      }
    }
    return { items }
  },

  '/api/admin/overview': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    return overviewFor(data.date || dateStr())
  },

  '/api/admin/history': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    const days = []
    for (let i = 1; i <= 14; i++) {
      const date = dateStr(-i)
      const list = workers.map(w => workerDayStatus(w, date))
      const done = list.filter(w => w.status === 'done')
      days.push({
        date,
        done: done.length,
        total: list.length,
        avg_score: done.length ? Math.round(done.reduce((s, w) => s + w.score, 0) / done.length) : 0
      })
    }
    return { days }
  },

  '/api/admin/worker': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    const w = workers.find(x => x.worker_id === data.worker_id) || workers[0]
    const mastery = masteryFor(w.worker_id)
    const weakest = mastery[0]
    const { records, next_review_date } = recordsFor(w.worker_id)
    return {
      worker: { ...w, phone: undefined, phone_masked: maskPhone(w.phone), group_name: groupName(w.group_id) },
      today: workerDayStatus(w, dateStr()),
      stats: {
        total_days: 15 + Math.floor(seeded(w.worker_id + '|td') * 20),
        streak: 1 + Math.floor(seeded(w.worker_id + '|st') * 7),
        avg_score: 70 + Math.floor(seeded(w.worker_id + '|av') * 25)
      },
      mastery,
      review: {
        date: next_review_date,
        point: weakest ? weakest.point : '—',
        days_since: 2 + Math.floor(seeded(w.worker_id + '|ds') * 5),
        retention: 55 + Math.floor(seeded(w.worker_id + '|rt') * 30)
      },
      // 行为诊断（证据飞轮：行为数据的诊断结论，现桩为确定性规则）
      behavior: (() => {
        const pauses = 1 + Math.floor(seeded(w.worker_id + '|bp') * 4)
        const repeats = Math.floor(seeded(w.worker_id + '|br') * 3)
        let note = '近 7 天学习专注，无异常中断'
        if (weakest && weakest.value < 70) {
          note = `「${weakest.point}」内容上暂停较多，可能存在理解难点，建议班前会口头确认`
        } else if (repeats >= 2) {
          note = '重听次数偏多，建议下次推送降低语速'
        }
        return { pauses, repeats, note }
      })(),
      records,
      next_review_date
    }
  },

  '/api/admin/remind': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    return {
      ok: true,
      reminded: (data.worker_ids || []).length,
      note: '正式环境接订阅消息/语音外呼；演示期建议班前会口头提醒'
    }
  },

  '/api/tasks': async data => {
    const deny = await denyUnlessAdmin(data); if (deny) return deny
    const target = data.target || 'all'
    const targetCount = target === 'all'
      ? workers.length
      : target.startsWith('worker:')
        ? 1
        : workers.filter(w => w.group_id === target.replace(/^group:/, '')).length
    todayTask = {
      task_id: 'task-' + Date.now(),
      date: data.date || dateStr(),
      task_text: data.task_text || '',
      note: data.note || '',
      kb_ids: data.kb_ids || [],
      env: data.env || null,          // 工作环境快照 { lat, lng, weather }（pushEdit 自动定位获取；①工序解析的环境输入）
      pushed_by: '班组长-刘志强',
      pushed_at: nowHM(),
      target
    }
    pushRecords.unshift({
      ...todayTask,
      target_desc: targetDesc(target),
      target_count: targetCount
    })
    // 推送即生成：管理员一发送，立刻按新工序生成今日剧本草稿（管线 B：LLM 优先，桩兜底）
    const draft = await generateDraft()
    persist()
    return {
      ok: true, task_id: todayTask.task_id, pushed_at: todayTask.pushed_at, target_count: targetCount,
      draft: { generated_at: draft.generated_at, point_count: draft.point_count, quiz_count: draft.quiz_count }
    }
  },

  '/api/workers/save': async data => {
    const oid = await resolveOpenid(data)
    if (!isAdmin(oid)) return { error: 'forbidden: admin only' }
    const w = data.worker || {}
    if (w.phone && !/^1\d{10}$/.test(String(w.phone))) {
      return { error: '手机号格式不正确' }
    }
    const r = upsertWorker(w)
    if (r.error) return r
    const saved = r.worker
    const key = keyFor(saved.worker_id)
    persist()
    return {
      ok: true,
      worker: { ...saved, phone: undefined, phone_masked: maskPhone(saved.phone) },
      bind: {
        scene: `w=${saved.worker_id}&k=${key}`,
        qr_text: `BQ5|B|${saved.worker_id}.${key}`,
        wxacode_url: await wxacodeImage(`w=${saved.worker_id}&k=${key}`)
      }
    }
  }
}

/* ================= 服务 ================= */

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {})
  const url = req.url.split('?')[0]

  if (req.method === 'GET' && url === '/') {
    return json(res, { ok: true, name: 'banqian-5min-server', endpoints: Object.keys(routes) })
  }

  // 静态文件服务：/codes/*.jpg 小程序码 | /tts/*.mp3 合成语音（不走 nginx alias，/root 权限问题）
  if (req.method === 'GET' && (url.startsWith('/codes/') || url.startsWith('/tts/'))) {
    const name = path.basename(url)   // 防目录穿越
    const dir = url.startsWith('/codes/') ? CODES_DIR : TTS_DIR
    const fp = path.join(dir, name)
    if (!fs.existsSync(fp)) return json(res, { error: 'not found' }, 404)
    res.writeHead(200, {
      'Content-Type': name.endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg',
      'Cache-Control': 'public, max-age=2592000'
    })
    return fs.createReadStream(fp).pipe(res)
  }

  const handler = routes[url]
  if (!handler) return json(res, { error: 'not found: ' + url }, 404)

  const body = await readBody(req)
  const isJson = (req.headers['content-type'] || '').includes('application/json')
  let data
  try {
    data = isJson ? JSON.parse(body.toString() || '{}') : { _bytes: body.length }
  } catch (e) {
    return json(res, { error: 'invalid JSON body' }, 400)
  }
  if (!isJson && req.headers['x-dev-id']) data.dev_id = req.headers['x-dev-id']   // 音频上传的身份走 header

  try {
    const out = await handler(data, isJson, body)   // body=原始字节，/api/asr、/api/command 音频用
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${url}`, isJson ? data : `<${data._bytes}B file>`, '→', out)
    json(res, out)
  } catch (e) {
    console.error(url, e)
    json(res, { error: String(e) }, 500)
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`banqian-5min-server listening on http://0.0.0.0:${PORT}`)
  console.log(`本机访问: http://localhost:${PORT}/`)
})

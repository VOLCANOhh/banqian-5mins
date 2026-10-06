const config = require('../config')
const mock = require('./mock')

// 设备身份：AppSecret 就位前用本机持久随机串充当 openid 占位（绑定关系跟着它走）；
// 正式环境由 wx.login code → jscode2session 出真 openid，dev_id 只做降级。
function devId() {
  let id = wx.getStorageSync('dev_id')
  if (!id) {
    id = 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    wx.setStorageSync('dev_id', id)
  }
  return id
}

// 统一请求入口：USE_MOCK=true 返回假数据，否则打后端 orchestrator
// 协议全文见 miniprogram/PROTOCOL.md
function call(path, data) {
  data = { dev_id: devId(), ...(data || {}) }   // 所有请求都带身份
  if (config.USE_MOCK) {
    return new Promise(r => setTimeout(() => r(mock.call(path, data)), config.MOCK_DELAY))
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.API_BASE + path,
      method: 'POST',
      data,
      timeout: 15000,
      success: res => res.statusCode === 200 ? resolve(res.data) : reject(res.data || res),
      fail: reject
    })
  })
}

// 文件上传：读本地文件→原始字节 POST（比 multipart 简单，后端直接拿 wav 给 ASR）
function upload(path, filePath) {
  if (config.USE_MOCK) return Promise.resolve(mock.call(path, {}))
  return new Promise((resolve, reject) => {
    let buf
    try { buf = wx.getFileSystemManager().readFileSync(filePath) } catch (e) { return reject(e) }
    wx.request({
      url: config.API_BASE + path,
      method: 'POST',
      data: buf,
      header: { 'Content-Type': 'application/octet-stream', 'X-Dev-Id': devId() },
      timeout: 20000,
      success: res => res.statusCode === 200 ? resolve(res.data) : reject(res.data || res),
      fail: reject
    })
  })
}

module.exports = {
  // 身份与角色：openid → { role, worker?, need_bind? }（启动时第一个调，决定进哪端）
  me: extra => call('/api/me', extra || {}),

  // 演示工友：扫门口码但本机没绑工人档案时的演示兜底——mock 给假数据第一个工人；真链路返回 null（→ 绑定页）
  demoWorker: () => (config.USE_MOCK && mock.demoWorker) ? mock.demoWorker() : null,

  /* ---------- 绑定（二维码体系） ---------- */
  // 机制1·工人端：刷身份码 → { bound, ticket, qr_text, manual_code, expires_in }
  bindTicket: () => call('/api/bind/ticket'),
  // 机制1·管理端：扫到/手输 ticket → 认领。worker_id 绑已有；或 {worker:{...}} 新建
  bindClaim: (ticket, payload) => call('/api/bind/claim', { ticket, ...(payload || {}) }),
  // 机制2·管理端：发码 → { qr_text, scene, wxacode_url? }；regenerate 作废旧码
  bindCode: (workerId, regenerate) => call('/api/bind/code', { worker_id: workerId, regenerate: !!regenerate }),
  // 机制2·工人端：扫管理员码 → { ok, worker }
  bindResolve: code => call('/api/bind/resolve', { code }),
  // 管理员激活：扫管理员码 → 输口令
  adminActivate: payload => call('/api/admin/activate', payload),   // { qr_key }：管理员码内嵌 key，扫码即激活

  // 工友档案列表（管理端工人管理页用）
  getWorkers: () => call('/api/workers'),

  // 今日会话：后端一次下发完整剧本 steps（说什么/何时问/答完是否强调全在里面）
  getSession: workerId => call('/api/session/today', { worker_id: workerId }),

  // 提交某一步的回答 → 判定 + next_steps（后端可插入强调/重问，前端插进队列继续走）
  answer: (sessionId, stepId, text) =>
    call('/api/answer', { session_id: sessionId, step_id: stepId, answer_text: text }),

  // 会话结束 → 成绩汇总 + 下次复训；events=行为埋点（暂停/重听/答题用时，证据飞轮）
  finish: (sessionId, events) => call('/api/session/finish', { session_id: sessionId, events: events || [] }),

  // 语音指令：录音文件上传 → { action, direction?, echo }
  command: filePath => upload('/api/command', filePath),

  // 调试：文本指令直通，验证动作执行不需要真录音
  commandText: text => call('/api/command', { text }),

  // 朗读中打断提问：{steps[], drop_rest?, replay_current?}
  ask: (sessionId, stepId, question) => call('/api/ask', { session_id: sessionId, step_id: stepId, question }),

  // 答题语音识别：上传录音 → { text }。Key 只在后端
  asr: filePath => upload('/api/asr', filePath),

  /* ---------- 管理员端（服务端按 openid 鉴权，工人调用一律 403） ---------- */

  // 今日/昨日看板：{ date, task, stats:{total,done,avg_score,done_diff}, workers:[{...status,score}] }
  adminOverview: date => call('/api/admin/overview', date ? { date } : {}),

  // 往期汇总：近 14 天 [{date, done, total, avg_score}]
  adminHistory: () => call('/api/admin/history'),

  // 单个工人详细学习情况：{ worker, today, stats, mastery[], review, records[] }
  adminWorker: workerId => call('/api/admin/worker', { worker_id: workerId }),

  // 一键提醒未学工人：{ worker_ids } → { ok, reminded, note }
  adminRemind: workerIds => call('/api/admin/remind', { worker_ids: workerIds }),

  // 规范检索：工序文本 → 命中规范条目 [{kb_id,title,doc_no,clause,summary,score}]
  kbSearch: query => call('/api/kb/search', { query }),

  // 推送内容库：{ items:[{content_id,title,job_tag,kb_ids,kb[],points[],quiz[]}] }（详情随条目全量返回）
  contentList: () => call('/api/content/list'),

  // 分组列表（含人数）：{ groups:[{group_id,name,count}] }
  getGroups: () => call('/api/groups'),

  // 添加分组：{ name } → { ok, group }
  saveGroup: name => call('/api/groups/save', { name }),

  // 工作环境天气：wx.getLocation(wgs84) 定位 → 服务端代理和风天气（Key 只在后端，失败桩兜底不断链）
  // 返回 { lat, lng, weather }；pushTask 时整体作为 env 上送 → ①工序解析的「工作环境信息」输入
  getWeather: () => {
    if (config.USE_MOCK) return call('/api/weather', {})
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'wgs84',
        timeout: 8000,
        success: loc => call('/api/weather', { lat: loc.latitude, lng: loc.longitude })
          .then(r => (r && r.weather) ? resolve({ lat: loc.latitude, lng: loc.longitude, weather: r.weather }) : reject(r))
          .catch(reject),
        fail: reject
      })
    })
  },

  // 推送学习内容：{ date?, task_text, note?, kb_ids?, target, env? } → { ok, task_id, pushed_at, target_count }
  pushTask: task => call('/api/tasks', task),

  // 推送记录（主界面）：{ items:[{task_id,date,pushed_at,task_text,note,kb_ids,kb[],target,target_desc,target_count,pushed_by}] }
  tasksList: () => call('/api/tasks/list'),

  // AI 预测推荐：{ items:[{rec_id,title,content_id,kb_ids,target,target_desc,reason,level}] }
  aiRecommend: () => call('/api/ai/recommend'),

  // 新增/更新工人档案：{ worker }（无 worker_id=新增）→ { ok, worker, bind }
  saveWorker: worker => call('/api/workers/save', { worker })
}

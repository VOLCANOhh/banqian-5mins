// Mock 数据 = 接口契约：后端 orchestrator 照此字段格式返回即可对接
// 协议全文见 miniprogram/PROTOCOL.md
const config = require('../config')

/* ================= 分组与工人 ================= */

const groups = [
  { group_id: 'g1', name: '一班' },
  { group_id: 'g2', name: '二班' },
  { group_id: 'g3', name: '塔吊组' }
]

const workers = [
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

/* ================= 推送内容库（标题 + 详细真实推送内容：规范/要点/考题） ================= */

const CONTENT_LIB = [
  { content_id: 'c01', title: '三层外墙脚手架搭设', job_tag: '架子工', kb_ids: ['kb01', 'kb02'],
    points: ['连墙件必须按两步三跨设置，严禁随意拆除', '作业层外侧随搭设同步满挂密目安全网，栏杆不低于1米2', '搭设过程工具入袋、材料不抛掷，防物体打击'],
    quiz: ['连墙件应该按什么间距设置？', '作业层外侧的安全网什么时候挂？'] },
  { content_id: 'c02', title: '二层模板支设', job_tag: '木工', kb_ids: ['kb03'],
    points: ['模板支架必须验收合格后方可使用', '支架上严禁超载集中堆放材料', '拆模须申请审批，按顺序拆除'],
    quiz: ['模板支架使用前要做什么？', '支架上能集中堆放材料吗？'] },
  { content_id: 'c03', title: '钢筋绑扎', job_tag: '钢筋工', kb_ids: ['kb08'],
    points: ['临边洞口设防护栏杆或盖板，并挂警示标志', '高空绑扎钢筋必须系挂安全带', '钢筋骨架临时固定，防止倾倒'],
    quiz: ['洞口作业该怎么防护？'] },
  { content_id: 'c04', title: '四层混凝土浇筑', job_tag: '混凝土工', kb_ids: ['kb04'],
    points: ['分层浇筑、分层振捣，快插慢拔', '振捣棒严禁直接触碰钢筋与模板', '夜间浇筑照明先行'],
    quiz: ['振捣棒能直接碰钢筋吗？'] },
  { content_id: 'c05', title: '塔吊顶升作业', job_tag: '塔吊司机', kb_ids: ['kb05', 'kb06'],
    points: ['顶升时严禁下方站人，设置警戒区', '风力超过4级停止顶升作业', '执行"十不吊"，信号不明不起吊'],
    quiz: ['几级风停止顶升？', '什么情况下不许吊？'] },
  { content_id: 'c06', title: '临边防护搭设', job_tag: '架子工', kb_ids: ['kb08'],
    points: ['临边必须设防护栏杆，高度不低于1米2', '栏杆挂密目网并设挡脚板', '每日巡查防护是否被拆动'],
    quiz: ['临边防护栏杆最低多高？'] },
  { content_id: 'c07', title: '临时用电作业', job_tag: '电工', kb_ids: ['kb07'],
    points: ['一机一闸一漏，严禁私拉乱接', '配电箱上锁并挂警示牌', '湿手不碰开关，停电挂牌检修'],
    quiz: ['配电箱能不能私拉乱接？'] }
]

/* ================= 今日任务与剧本 ================= */

// 管理员推送的「今日学习内容」——/api/tasks 会改它，session/today 联动
let todayTask = {
  task_id: 'task-001',
  date: '2026-09-30',
  task_text: '三层外墙脚手架搭设',
  note: '连墙件、安全网是今天重点',
  kb_ids: ['kb01', 'kb02'],
  pushed_by: '班组长-刘志强',
  pushed_at: '06:30',
  target: 'all'
}

// 「剧本」：后端一次下发，前端按序执行（真后端按 todayTask × 工人档案 × kb_ids 现场生成）
const steps = [
  { id: 's0', type: 'say', text: '今日学习：脚手架搭设高处作业安全要点。', voice: { speed: 0.95, tone: 'steady' } },
  { id: 's1', type: 'say', text: '今天三层外墙脚手架搭设。王师傅，上次考核里连墙件的知识点您答错了一题，今天重点过一遍。' },
  { id: 's2', type: 'say', text: '第一，连墙件必须按两步三跨设置，严禁随意拆除。脚手架坍塌事故，多数和连墙件缺失有关。' },
  { id: 's3', type: 'say', text: '第二，作业层外侧必须随搭设同步满挂密目安全网，栏杆高度不低于1米2。' },
  { id: 's4', type: 'say', text: '第三，搭设过程中工具入袋、材料不抛掷，防止物体打击伤人。' },
  { id: 'q1', type: 'ask', text: '问题一，连墙件应该按什么间距设置？', listen: { timeout_ms: 30000 } },
  { id: 'q2', type: 'ask', text: '问题二，作业层外侧的安全网什么时候挂？', listen: { timeout_ms: 30000 } }
]

// 语音指令关键词 → 动作（mock 用；真路径是录音文件上传后由小模型意图识别）
function matchCommand(t) {
  if (/大点声|音量大|大声/.test(t)) return { action: 'set_volume', direction: 'up', echo: t }
  if (/小点声|音量小|小声/.test(t)) return { action: 'set_volume', direction: 'down', echo: t }
  if (/字体?大|看不清/.test(t))      return { action: 'set_font', direction: 'up', echo: t }
  if (/字体?小/.test(t))             return { action: 'set_font', direction: 'down', echo: t }
  if (/暂停|停一下|等一下/.test(t))  return { action: 'pause', echo: t }
  if (/继续|接着|开始/.test(t))      return { action: 'resume', echo: t }
  if (/再说|重复|重来|没听清/.test(t)) return { action: 'repeat', echo: t }
  if (/跳过|下一句|快进/.test(t))    return { action: 'next', echo: t }
  return { action: 'none', echo: t }
}

/* ---------- 确定性伪随机（FNV-1a）：同一 key 永远同一结果，翻页不穿帮 ---------- */
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

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function nowHM() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// 字号规则：年龄决定，只大不小
function fontFor(age) {
  const a = +age || 0
  return a >= 50 ? 'xxl' : (a >= 40 ? 'xl' : 'l')
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
  const yDone = workers.filter(w => workerDayStatus(w, today(-1)).status === 'done').length
  return {
    date,
    task: date === today() ? todayTask : {
      task_id: 'task-y001', date, task_text: TASK_POOL[hash(date) % TASK_POOL.length],
      note: '', kb_ids: [], pushed_by: '班组长-刘志强', pushed_at: '06:28', target: 'all'
    },
    stats: {
      total: list.length,
      done: done.length,
      avg_score: done.length ? Math.round(done.reduce((s, w) => s + w.score, 0) / done.length) : 0,
      done_diff: date === today() ? done.length - yDone : 0
    },
    workers: list
  }
}

// 知识点掌握度（学情诊断可视化）：每人 3~5 点，55~98，按掌握度升序（最薄弱在前）
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

// 近期记录（带错题详情）
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
      date: today(dayOff).slice(5),
      full_date: today(dayOff),
      task_text: TASK_POOL[Math.floor(seeded(workerId + '|t' + i) * TASK_POOL.length)],
      score: 55 + Math.floor(seeded(workerId + '|s' + i) * 45),
      wrong_count: wrongCount,
      wrongs
    })
  }
  const reviewOff = -3 + Math.floor(seeded(workerId + '|r') * 10)   // -3..6（约三成复训已逾期，供 AI 推荐）
  return { records, next_review_date: today(reviewOff) }
}

/* ================= AI 每日剧本（升级1：内容现做——系统不存预制内容，管理员一推送就由编排器现写） ================= */

const CN_NUM = ['一', '二', '三', '四', '五']

// 每条内容在推送时生成一份剧本：steps（工人实际听到的）+ trace（六角色证据链，可审计）
function draftFor(content) {
  const t = today()
  // 学情诊断证据：找薄弱点与本内容相关的工人（确定性复用 mastery 数据）
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

/* ================= 推送记录（主界面数据；/api/tasks 成功后追加） ================= */

function targetDesc(target) {
  if (target === 'all') return '全部工人'
  if (target.startsWith('worker:')) {
    const w = workers.find(x => x.worker_id === target.slice(7))
    return w ? w.name : target
  }
  if (target.startsWith('group:')) return groupName(target.slice(6))
  return target
}

const pushRecords = [
  { task_id: 'task-001', date: today(), pushed_at: '06:30', task_text: '三层外墙脚手架搭设', note: '连墙件、安全网是今天重点', kb_ids: ['kb01', 'kb02'], target: 'all', target_desc: '全部工人', target_count: 12, pushed_by: '班组长-刘志强',
    env: { lat: 36.65, lng: 117.12, weather: { temp: '24', feels_like: '25', text: '多云', wind_dir: '东北风', wind_scale: '2', wind_speed: '9', humidity: '58', precip: '0.0', pressure: '1010', vis: '22', obs_time: '2026-10-05T06:30+08:00', source: 'stub', risk_level: 'normal', risk_hints: [] } } },
  { task_id: 'task-y001', date: today(-1), pushed_at: '06:28', task_text: '二层模板支设', note: '', kb_ids: ['kb03'], target: 'all', target_desc: '全部工人', target_count: 12, pushed_by: '班组长-刘志强' },
  { task_id: 'task-y002', date: today(-2), pushed_at: '06:35', task_text: '塔吊顶升作业', note: '顶升时严禁下方站人', kb_ids: ['kb05', 'kb06'], target: 'group:g3', target_desc: '塔吊组', target_count: 3, pushed_by: '班组长-刘志强' }
]

function call(path, data) {
  data = data || {}
  switch (path) {

    /* ---------- 身份与角色 ---------- */
    case '/api/me': {
      if (config.MOCK_ROLE === 'admin') {
        return { openid: 'mock-openid-admin', role: 'admin', name: '班组长-刘志强' }
      }
      if (config.MOCK_ROLE === 'new') {   // 未绑定设备 → 走身份码页
        return { openid: 'mock-new-device', role: 'worker', worker: null, need_bind: true }
      }
      return { openid: 'mock-openid-w001', role: 'worker', worker: workers[0] }
    }

    /* ---------- 绑定（二维码体系） ---------- */
    case '/api/bind/ticket':
      return { bound: false, ticket: '123456', qr_text: 'BQ5|T|123456', manual_code: '123456', expires_in: 600 }

    case '/api/bind/claim': {
      const w = data.worker_id
        ? workers.find(x => x.worker_id === data.worker_id) || workers[0]
        : { worker_id: 'w' + String(workers.length + 1).padStart(3, '0'), ...(data.worker || {}), font_size: 'xl' }
      return { ok: true, worker: { ...w, phone: undefined, phone_masked: maskPhone(w.phone) } }
    }

    case '/api/bind/code': {
      const wid = data.worker_id || 'w001'
      return { worker_id: wid, key: 'abc123', qr_text: `BQ5|B|${wid}.abc123`, scene: `w=${wid}&k=abc123`, wxacode_url: null }
    }

    case '/api/bind/resolve': {
      const m = String(data.code || data.scene || '').match(/w=?(\d+)/i)
      const w = workers.find(x => x.worker_id === 'w' + (m ? m[1] : '001'))
      return { ok: true, worker: w || workers[0] }
    }

    case '/api/ask':
      // 打断提问桩：返回回答 steps；replay_current → 答完重讲中断段；drop_rest → 剩余作废
      return {
        question: data.question || '',
        steps: [{
          id: 'qa-mock', type: 'say',
          text: '问得好。简单说就是：垫板把立杆的受力分散到地面，不让它一个点往下沉。听明白了我们就接着往下讲。',
          voice: { tone: 'teacher' }
        }],
        replay_current: true,
        drop_rest: false
      }

    case '/api/admin/activate':
      // {qr_key}：管理员码内嵌 key，扫码即激活；mock 一律放行
      return { ok: true, role: 'admin', name: '班组长-刘志强' }

    case '/api/wxacode':
      return { scene: data.scene || '', image_url: null, note: 'mock：未接 wxacode，用 qr_text 文本码' }

    case '/api/workers':
      // 管理端列表：手机号脱敏下发
      return { workers: workers.map(w => ({ ...w, phone: undefined, phone_masked: maskPhone(w.phone), group_name: groupName(w.group_id) })) }

    case '/api/groups':
      return { groups: groups.map(g => ({ ...g, count: workers.filter(w => w.group_id === g.group_id).length })) }

    case '/api/groups/save': {
      if (!data.name || !String(data.name).trim()) return { error: '组名不能为空' }
      const g = { group_id: 'g' + (groups.length + 1), name: String(data.name).trim().slice(0, 12) }
      groups.push(g)
      return { ok: true, group: g }
    }

    /* ---------- 推送内容库（标题列表；检索在前端做；每条附 AI 今日剧本 draft） ---------- */
    case '/api/content/list':
      return {
        items: CONTENT_LIB.map(c => {
          const withKb = {
            ...c,
            kb: c.kb_ids.map(id => KB.find(k => k.kb_id === id)).filter(Boolean)
          }
          return { ...withKb, draft: draftFor(withKb) }
        })
      }

    /* ---------- 规范检索（特征函数匹配的坑位；真算法归编排器） ---------- */
    case '/api/kb/search': {
      const q = String(data.query || '').trim()
      if (!q) return { items: [] }
      const items = KB.map(k => {
        let score = 0
        for (const kw of k.keywords) if (q.includes(kw)) score += 32
        for (const ch of q) if (/[一-龥]/.test(ch) && (k.summary.includes(ch) || k.title.includes(ch))) score += 1
        return { ...k, score: Math.min(99, score) }
      }).filter(k => k.score > 3).sort((a, b) => b.score - a.score).slice(0, 5)
      // 检索不到时兜底返回前三条，保证演示链不断
      return { items: items.length ? items : KB.slice(0, 3).map(k => ({ ...k, score: 75 })) }
    }

    /* ---------- 工人端学习链路 ---------- */
    case '/api/session/today':
      return {
        session_id: 'mock-session-001',
        worker: workers.find(w => w.worker_id === data.worker_id) || workers[0],
        task_text: todayTask.task_text,
        steps
      }

    case '/api/answer': {
      const t = data.answer_text || ''
      const isQ1 = data.step_id.startsWith('q1')
      const okRe = isQ1 ? /两步三跨|2步3跨/ : /同步|随.*挂|边.*挂/
      // 变式步（-var）答完即止
      if (/-var$/.test(data.step_id)) {
        const ok = okRe.test(t)
        return { verdict: ok ? 'correct' : 'partial', next_steps: [
          { id: data.step_id + '-end', type: 'say', text: ok ? '对，就是这个理。' : '已记录，继续。' }
        ]}
      }
      // 重问步（-re）：扶助对收束；二次错只给答案收束
      if (/-re$/.test(data.step_id)) {
        const ok = okRe.test(t)
        return ok
          ? { verdict: 'correct', next_steps: [{ id: data.step_id + '-end', type: 'say', text: '对，这次说全了。' }] }
          : { verdict: 'wrong', next_steps: [{ id: data.step_id + '-fix', type: 'say',
              text: '正确答案是：' + (isQ1 ? '两步三跨，严禁后补。' : '随搭设同步满挂。') }] }
      }
      const ok = okRe.test(t)
      const fuzzy = !ok && (isQ1 ? /两步|三跨|间距/.test(t) : /网|挂/.test(t))
      if (ok) {
        // 答对 → 情景变式追问（测迁移，不测背诵）——「考官」协议坑位
        return { verdict: 'correct', next_steps: [
          { id: data.step_id + '-ok', type: 'say', text: '回答正确。' },
          { id: data.step_id + '-var', type: 'ask',
            text: '再问一句：' + (isQ1 ? '如果你上工时发现连墙件被人拆了，应该怎么办？' : '如果看到安全网破了个洞，今天要不要换？'),
            listen: { timeout_ms: 30000 } }
        ]}
      }
      if (fuzzy) {
        // 答得模糊 → 针对模糊点钻一层
        return { verdict: 'partial', next_steps: [
          { id: data.step_id + '-hint', type: 'say',
            text: '接近了，但还不完整。' + (isQ1 ? '"两步"和"三跨"两个数都要记住，缺一不可。' : '关键在"同步"二字——不是事后补挂。') },
          { id: data.step_id + '-re', type: 'ask',
            text: '完整说一遍：' + (isQ1 ? '连墙件按什么间距设置？' : '安全网什么时候挂？'),
            listen: { timeout_ms: 30000 } }
        ]}
      }
      // 答错 → 先挖一层：不给答案，先让他再试一次（二次错才给答案）
      return { verdict: 'wrong', next_steps: [
        { id: data.step_id + '-dig', type: 'say', text: '再想想——别急着放弃，工地上这个事每天都能看见。' },
        { id: data.step_id + '-re', type: 'ask',
          text: '再试一次：' + (isQ1 ? '连墙件按什么间距设置？' : '安全网什么时候挂？'),
          listen: { timeout_ms: 30000 } }
      ]}
    }

    case '/api/session/finish':
      return {
        score: 80,
        wrong_items: [{ q_id: 'q2', your: '干完再挂', correct: '随搭设同步满挂' }],
        mastery_update: { '连墙件设置要求': '已达标', '安全网张挂时机': '待巩固' },
        next_review_date: today(3),
        received_events: (data.events || []).length,   // 行为埋点回执（证据飞轮，进档案）
        trace: [
          { role: '考评', score: 80 },
          { role: '复训调度', next: today(3), algo: 'SM-2简化' },
          { role: '行为诊断', events: (data.events || []).length }
        ]
      }

    case '/api/command':
      return matchCommand(data.text || '')

    // 答题语音识别桩：固定返回 q1 的标准答案（q1 判对、q2 判错，演示链完整）
    case '/api/asr':
      return { text: '两步三跨' }

    /* ---------- 推送记录 ---------- */
    case '/api/weather':
      // mock 演示数据：6 级大风压线「六级风条款」，演示时天气卡自动带红色预警（想演平静天气改 wind_scale 即可）
      return {
        lat: 36.65, lng: 117.12,
        weather: {
          temp: '28', feels_like: '29', text: '晴',
          wind_dir: '南风', wind_scale: '6', wind_speed: '39',
          humidity: '42', precip: '0.0', pressure: '1002', vis: '18',
          obs_time: '2026-10-06T06:30+08:00',
          source: 'stub', note: 'mock 演示数据',
          risk_level: 'high',
          risk_hints: [{ level: 'high', text: '6级大风：停止露天高处作业与起重吊装（六级风条款）' }]
        }
      }

    case '/api/tasks/list':
      return {
        items: pushRecords.map(r => ({
          ...r,
          kb: (r.kb_ids || []).map(id => KB.find(k => k.kb_id === id)).filter(Boolean)
        }))
      }

    /* ---------- AI 预测推荐（规则引擎桩：复训逾期 × 薄弱点 × 内容匹配；真模型归编排器） ---------- */
    case '/api/ai/recommend': {
      const t = today()
      // 1. 找复训逾期工人及其最薄弱知识点
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
        // 2. 按薄弱点聚类，取 top2
        const byPoint = {}
        overdue.forEach(o => { (byPoint[o.point] = byPoint[o.point] || []).push(o) })
        const sorted = Object.entries(byPoint).sort((a, b) => b[1].length - a[1].length).slice(0, 2)
        for (const [point, list] of sorted) {
          // 3. 薄弱点 → 内容库匹配（知识点的核心词 ⊂ 内容标题/要点/规范摘要）
          const key = point.replace(/(设置要求|张挂时机|防护|规范|流程|佩戴|审批|十不吊)$/, '')
          const content = CONTENT_LIB.find(c =>
            c.title.includes(key) || c.points.some(p => p.includes(key)) ||
            c.kb_ids.some(id => {
              const k = KB.find(x => x.kb_id === id)
              return k && (k.summary.includes(key) || k.keywords.some(kw => point.includes(kw)))
            })
          )
          // 4. 对象判定：同组≥2 → 整组；单人 → 定向个人；跨组 → 全部
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
    }

    /* ---------- 管理员端 ---------- */
    case '/api/admin/overview':
      return overviewFor(data.date || today())

    case '/api/admin/history': {
      const days = []
      for (let i = 1; i <= 14; i++) {
        const date = today(-i)
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
    }

    case '/api/admin/worker': {
      const w = workers.find(x => x.worker_id === data.worker_id) || workers[0]
      const mastery = masteryFor(w.worker_id)
      const weakest = mastery[0]
      const { records, next_review_date } = recordsFor(w.worker_id)
      return {
        worker: { ...w, phone: undefined, phone_masked: maskPhone(w.phone), group_name: groupName(w.group_id) },
        today: workerDayStatus(w, today()),
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
        // 行为诊断（证据飞轮：暂停/重听等行为数据的 LLM 诊断结论，现桩为确定性规则）
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
    }

    case '/api/admin/remind':
      return {
        ok: true,
        reminded: (data.worker_ids || []).length,
        note: '正式环境接订阅消息/语音外呼；演示期建议班前会口头提醒'
      }

    case '/api/tasks': {
      const target = data.target || 'all'
      const targetCount = target === 'all'
        ? workers.length
        : target.startsWith('worker:')
          ? 1
          : workers.filter(w => w.group_id === target.replace(/^group:/, '')).length
      todayTask = {
        task_id: 'task-' + Date.now(),
        date: data.date || today(),
        task_text: data.task_text || '',
        note: data.note || '',
        kb_ids: data.kb_ids || [],
        env: data.env || null,          // 工作环境快照 { lat, lng, weather }（①工序解析的环境输入）
        pushed_by: '班组长-刘志强',
        pushed_at: nowHM(),
        target
      }
      // 写入推送记录（主界面展示）
      pushRecords.unshift({
        ...todayTask,
        target_desc: targetDesc(target),
        target_count: targetCount
      })
      // 推送即生成：立刻出剧本草稿回执（管理员一推送就生成，不等定时批量）
      const c = CONTENT_LIB.find(x => x.title === todayTask.task_text) || CONTENT_LIB[0]
      todayTask.draft = { generated_at: nowHM(), point_count: c.points.length, quiz_count: c.quiz.length }
      return { ok: true, task_id: todayTask.task_id, pushed_at: todayTask.pushed_at, target_count: targetCount, draft: todayTask.draft }
    }

    case '/api/workers/save': {
      const w = data.worker || {}
      // 手机号：填了就必须是 11 位数字（后端校验示范；编辑留空 = 不修改）
      if (w.phone && !/^1\d{10}$/.test(String(w.phone))) {
        return { error: '手机号格式不正确' }
      }
      let saved
      if (w.worker_id) {
        const i = workers.findIndex(x => x.worker_id === w.worker_id)
        if (i < 0) return { error: 'worker not found: ' + w.worker_id }
        saved = { ...workers[i], ...w, font_size: fontFor(w.age) }
        if (!w.phone) saved.phone = workers[i].phone   // 留空保留原值
        workers[i] = saved
      } else {
        if (!w.group_id) w.group_id = groups[0].group_id
        saved = {
          worker_id: 'w' + String(workers.length + 1).padStart(3, '0'),
          name: w.name || '',
          age: +w.age || 0,
          years: +w.years || 0,
          job: w.job || '其他',
          font_size: fontFor(w.age),
          group_id: w.group_id,
          phone: w.phone || ''
        }
        workers.push(saved)
      }
      return {
        ok: true,
        worker: { ...saved, phone: undefined, phone_masked: maskPhone(saved.phone) },
        bind: {
          scene: 'w=' + saved.worker_id + '&k=abc123',
          qr_text: 'BQ5|B|' + saved.worker_id + '.abc123',
          wxacode_url: null
        }
      }
    }

    default:
      return { error: 'mock: unknown path ' + path }
  }
}

module.exports = { call, demoWorker: () => workers[0] }   // demoWorker：门口码演示兜底（管理员/mock 身份扫门口码时进学习流用）

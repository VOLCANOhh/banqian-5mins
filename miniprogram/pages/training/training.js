const api = require('../../utils/api')
const voice = require('../../utils/voice')
const app = getApp()

// 前端 = 渲染器 + 执行器：剧本 steps、答题判定、语音指令全由后端 JSON 决定
// 协议全文见 miniprogram/PROTOCOL.md；UI 规范见 docs/ui-references.md

// 每行最多字数，随字号档变化（屏宽750rpx - 两侧padding96rpx ≈ 654rpx 可用）
const ROW_MAX = { l: 17, xl: 13, xxl: 10 }

// 把一段文字切成视觉行：优先在标点处断，超长按字数硬切
function toRows(text, fontSize) {
  const max = ROW_MAX[fontSize] || 13
  const rows = []
  let s = String(text)
  while (s.length > max) {
    let cut = -1
    for (const p of '，。！？；：、') {
      const i = s.lastIndexOf(p, max - 1)
      if (i > cut) cut = i
    }
    const n = cut > 0 ? cut + 1 : max
    rows.push(s.slice(0, n))
    s = s.slice(n).replace(/^[，。！？；：、\s]+/, '')
  }
  if (s) rows.push(s)
  return rows
}

// 每行停留时长：按字数估朗读时间（约200ms/字）；后端可用 hold_ms 覆盖，接 TTS 后换音频时长
const delayFor = text => Math.min(6000, 1200 + String(text).length * 180)

const countAsks = queue => queue.filter(s => s && s.type === 'ask').length

// 扫码入口解析：小程序码 options.scene（URL编码）/ 普通链接码 options.q（完整URL）
// → { type: 'admin'|'bind'|'gate', raw }
function parseScene(options) {
  let raw = ''
  try {
    if (options.scene) raw = decodeURIComponent(options.scene)
    else if (options.q) raw = decodeURIComponent(options.q)
  } catch (e) { raw = options.scene || options.q || '' }
  if (!raw) return null
  if (/r=admin/.test(raw)) return { type: 'admin', raw, key: (raw.match(/k=([a-z0-9-]+)/i) || [])[1] || '' }
  if (/w=w\d+/i.test(raw) && /k=[a-z0-9]+/i.test(raw)) return { type: 'bind', raw }
  return { type: 'gate', raw }
}

Page({
  data: {
    splash: true,     // 品牌启动页
    splashOut: false,
    lines: [],        // 字幕视觉行，随剧本执行不断追加
    idx: 0,
    scrollTop: 0,
    padH: 0,
    playing: true,
    phase: 'read',    // read 读正文 | ask 读题中 | listen 等你回答
    recording: false,
    fontSize: 'xl',
    ready: false,
    cmdOn: false,     // 指令监听中
    progress: 0,      // 顶部进度条 0-100
    stageText: '学习中',
    qTotal: 0,
    listenSec: 0,     // 已录秒数
    verdictPop: null  // 答题反馈弹卡 { kind: 'green'|'orange', text }
  },

  onLoad(options) {
    this.answers = []
    this.events = []    // 行为埋点（暂停/重听/答题用时）→ finish 时上送，进学习档案
    this.queue = []     // 待执行剧本（next_steps 会动态插入）
    this.i = 0

    // 扫码入口解析：小程序码 options.scene / 普通链接码 options.q
    const scene = parseScene(options || {})

    ;(app.loginP || Promise.resolve(''))
      .then(code => api.me({ code }))
      .then(me => {
        app.globalData.me = me

        // 路由铁律：码 > 身份——扫什么码进什么端；只有不扫码直接打开，才按 openid 角色分流
        //（旧逻辑 role==='admin' 挡在最前，导致管理员/演示身份扫门口码也进管理端，已修复）

        // ① 管理员码：已激活 → 管理端；未激活 → 登录页（带 key 自动登记，无 key 纯微信登录）
        if (scene && scene.type === 'admin') {
          if (me.role === 'admin') wx.switchTab({ url: '/pages/admin/push' })
          else wx.redirectTo({ url: '/pages/admin/login' + (scene.key ? '?k=' + scene.key : '') })
          return null
        }

        // ② 门口码：一律进工人学习流——已绑工人直接学；未绑定设备 → 绑定页；
        //    管理员扫门口码 = 体验工人端（mock 给演示工友，真链路无工人档案 → 绑定页）
        if (scene && scene.type === 'gate') {
          const w = me.worker || (me.role === 'admin' ? api.demoWorker() : null)
          if (!w) { wx.redirectTo({ url: '/pages/bind/bind' }); return null }
          return this.startFor(w)
        }

        // ③ 工人绑定码：未绑定设备原地自绑，直接开始学（已绑定则忽略 scene，按身份走）
        if ((me.need_bind || !me.worker) && scene && scene.type === 'bind') {
          return api.bindResolve(scene.raw)
            .then(r => this.startFor(r.worker))
            .catch(e => {
              wx.showToast({ title: (e && e.error) || '绑定码无效', icon: 'none' })
              wx.redirectTo({ url: '/pages/bind/bind' })
              return null
            })
        }

        // ④ 不扫码直接打开：按 openid 角色分流
        if (me.role === 'admin') {
          wx.switchTab({ url: '/pages/admin/push' })
          return null
        }
        if (me.need_bind || !me.worker) {
          wx.redirectTo({ url: '/pages/bind/bind' })
          return null
        }
        return this.startFor(me.worker)
      })
      .then(res => {
        if (!res) return   // 已分流
        app.globalData.sessionId = res.session_id
        wx.setStorageSync('session_meta', { task: res.task_text })
        this.queue = res.steps || []
        this.setData({ qTotal: countAsks(this.queue) })
        this.maybeStart()
      })
      .catch(() => this.pushText('内容加载失败，请联系班组长'))
  },

  startFor(worker) {
    app.globalData.worker = worker
    this.setData({ fontSize: worker.font_size || 'xl' })
    return api.getSession(worker.worker_id)
  },

  onReady() {
    // 布局就绪后量字幕区尺寸，再开跑
    const q = wx.createSelectorQuery().in(this)
    q.select('.lyric').boundingClientRect()
    q.exec(rs => {
      this.lyricH = rs[0].height
      this.setData({ padH: this.lyricH / 2 }, () => {
        this.measured = true
        this.maybeStart()
      })
    })
    // 品牌启动页：至少停 1.1s，渐隐关闭
    this.splashTimer = setTimeout(() => {
      this.setData({ splashOut: true })
      setTimeout(() => this.setData({ splash: false }), 450)
    }, 1100)
  },

  maybeStart() {
    if (this.measured && this.queue.length && !this.started) {
      this.started = true
      this.setData({ ready: true })
      this.step(0)
    }
  },

  /* ---------- 字幕滚动 ---------- */
  measureLines(cb) {
    const q = wx.createSelectorQuery().in(this)
    q.selectAll('.line').boundingClientRect()
    q.exec(rs => {
      let acc = 0
      this.lineTops = rs[0].map(r => { const t = acc; acc += r.height; return t })
      this.lineHs = rs[0].map(r => r.height)
      cb && cb()
    })
  },

  scrollToLine(i) {
    // 内容布局 = [上pad][lines...][下pad]，行的真实偏移要加上 padH
    const top = this.data.padH + this.lineTops[i] + this.lineHs[i] / 2 - this.lyricH / 2
    this.setData({ idx: i, scrollTop: Math.max(0, top) })
  },

  pushText(text, cb) {
    const rows = toRows(text, this.data.fontSize)
    this.setData({ lines: [...this.data.lines, ...rows] }, () =>
      this.measureLines(() => {
        this.scrollToLine(this.data.lines.length - rows.length)
        cb && cb(rows)
      })
    )
  },

  // 逐行播放：每行轮流居中，停自己的时长，走完调 onDone
  // hold_ms 给定时均摊到每行，否则按行字数估朗读时间
  playRows(i, rows, onDone) {
    const s = this.queue[i]
    this.rowPlay = {
      i, rows, onDone,
      base: this.data.lines.length - rows.length,
      per: s && s.hold_ms ? s.hold_ms / Math.max(1, rows.length) : 0,
      r: 0
    }
    this.tickRow()
  },

  tickRow() {
    const rp = this.rowPlay
    if (!rp) return
    if (rp.r >= rp.rows.length) {
      this.rowPlay = null
      return rp.onDone && rp.onDone()
    }
    this.scrollToLine(rp.base + rp.r)
    const hold = rp.per || delayFor(rp.rows[rp.r])
    rp.r++
    this.timer = setTimeout(() => this.tickRow(), hold)
  },

  /* ---------- 阶段与进度 ---------- */
  syncStage(phase) {
    let stageText = '学习中'
    if (phase === 'ask') stageText = '请听题'
    if (phase === 'qa') stageText = '请说你的问题'
    if (phase === 'listen') {
      const q = Math.min(this.answers.length + 1, this.data.qTotal)
      stageText = `请回答 · 第${q}题/共${this.data.qTotal}题`
    }
    this.setData({ phase, stageText })
  },

  syncProgress() {
    const progress = Math.min(100, Math.round(this.i / Math.max(1, this.queue.length) * 100))
    this.setData({ progress, qTotal: countAsks(this.queue) })
  },

  /* ---------- 剧本执行 ---------- */
  step(i) {
    this.i = i
    this.syncProgress()
    if (i >= this.queue.length) return this.finish()
    const s = this.queue[i]
    if (!s || !s.type) return this.step(i + 1)

    this.rowPlay = null                    // 每步重新建立行播放状态
    if (s.type !== 'say') this.stopCmdListen()   // 指令监听只在朗读步开

    switch (s.type) {
      case 'say':
        this.syncStage('read')
        this.pushText(s.text, rows => {
          this.startCmdListen()
          // TTS 驱动：音频真时长摊到每行滚动，onEnded 推进；无插件 → 定时器降级
          const audio = voice.say(s.text, {
            audio_url: s.audio_url,
            speed: s.speed,
            volume: app.globalData.volume,
            onStart: dur => {
              if (this.rowPlay && this.rowPlay.i === i && dur)
                this.rowPlay.per = dur * 1000 / Math.max(1, rows.length)
            },
            onEnd: () => {
              if (this.i !== i) return               // 已被 repeat/next 切走
              clearTimeout(this.timer)
              this.rowPlay = null
              this.step(i + 1)
            },
            onError: () => {
              // 音频播放失败（弱网/域名/格式）：定时器节奏兜底，按字数滚完再继续，绝不"秒结束"
              if (this.i !== i) return
              clearTimeout(this.timer)
              this.rowPlay = null
              this.timer = setTimeout(() => this.step(i + 1), Math.min(6000, 1500 + String(s.text).length * 200))
            }
          })
          this.playRows(i, rows, audio ? null : () => this.step(i + 1))
        })
        break
      case 'show':
        this.pushText(s.text, () => this.step(i + 1))
        break
      case 'ask':
        this.syncStage('ask')
        this.pushText(s.text, rows => {
          // 读题：TTS 念完自动开录；无插件 → 行滚动估时后开录
          const audio = voice.say(s.text, {
            audio_url: s.audio_url,
            volume: app.globalData.volume,
            onEnd: () => {
              if (this.i !== i) return
              clearTimeout(this.timer)
              this.rowPlay = null
              this.listen(s)
            },
            onError: () => {
              // 题目音频失败同样兜底：按字数估时后开录，不秒进
              if (this.i !== i) return
              clearTimeout(this.timer)
              this.rowPlay = null
              this.timer = setTimeout(() => this.listen(s), Math.min(4000, 1200 + String(s.text).length * 150))
            }
          })
          this.playRows(i, rows, audio ? null : () => this.listen(s))
        })
        break
      case 'action':
        this.applyAction({ action: s.op, direction: s.direction, value: s.value })
        this.step(i + 1)
        break
      default:
        this.step(i + 1)
    }
  },

  /* ---------- 打断提问（朗读期"没听懂·问一下"） ---------- */
  // 工人随时打断 → 录问题 → /api/ask → 后端决定回答内容 + 是否重读本段/改写后续
  tapAsk() {
    if (this.data.phase !== 'read' || this.data.recording) return
    const i = this.i
    this.qaStep = i                          // 记住被打断的步
    this.stopCmdListen()                     // 麦克风让给提问
    voice.pause()                            // TTS 暂停（rowPlay 保留，失败可续播）
    clearTimeout(this.timer)
    this.syncStage('qa')
    this.setData({ phase: 'qa', recording: true, listenSec: 0, qaThinking: false })
    this.secTimer = setInterval(() => this.setData({ listenSec: this.data.listenSec + 1 }), 1000)
    const started = voice.start(text => {
      clearInterval(this.secTimer)
      this.setData({ recording: false, qaThinking: true })
      const q0 = String(text || '').trim()
      // 噪音/敷衍单字（嗯啊呃）不算问题——按"没听清"本地处理，不拿它去打答疑接口
      const q = (q0.length < 2 || /^(嗯|啊|呃|额|哦|噢|唔|哼|哈|唉|哎)+$/.test(q0)) ? '' : q0
      this.pushText('你的问题：' + (q || '（没听清）'), () => {
        this.setData({ stageText: '老师傅在想…' })
        api.ask(app.globalData.sessionId, (this.queue[this.qaStep] || {}).id, q)
          .then(res => this.spliceAsk(res))
          .catch(() => this.resumeAfterQa())
      })
    })
    if (!started) this.resumeAfterQa()     // 麦克风被占 → 回到朗读
  },

  // 后端回答来了：插入回答 steps；replay_current → 答完重讲被打断的那段；drop_rest → 剩余剧本作废
  spliceAsk(res) {
    const i = this.qaStep
    const cur = this.queue[i]
    const insert = res.steps || []
    const tail = res.drop_rest ? [] : this.queue.slice(i + 1)
    this.queue = this.queue.slice(0, i)
      .concat(insert, res.replay_current ? [cur] : [], tail)
    this.rowPlay = null
    this.setData({ phase: 'read', qaThinking: false })
    this.step(i)                              // insert[0] 落在 index i
  },

  // 提问链路失败兜底：回到被打断的位置继续读
  resumeAfterQa() {
    this.setData({ phase: 'read', qaThinking: false })
    this.syncStage('read')
    voice.resume()
    const rp = this.rowPlay
    if (rp) {
      if (rp.r > 0) rp.r--
      this.tickRow()
    } else {
      this.step(this.i + 1)
    }
  },

  /* ---------- 答题：录 → /api/answer → 反馈弹卡 → next_steps 插回队列 ---------- */
  listen(s) {
    this.stopCmdListen()                    // 麦克风让给答题
    this.syncStage('listen')
    this.setData({ recording: true, listenSec: 0 })
    // 录音秒表
    this.secTimer = setInterval(() => this.setData({ listenSec: this.data.listenSec + 1 }), 1000)
    this.recT0 = Date.now()
    // TODO: 首次先 wx.authorize scope.record，被拒提示找班组长
    voice.start(text => {
      clearInterval(this.secTimer)
      this.setData({ recording: false })
      this.events.push({ type: 'answer_ms', step_id: s.id, ms: Date.now() - this.recT0 })   // 答题用时埋点
      // 环境噪音/敷衍单字（嗯啊呃）按"没听清"本地处理——不拿它去打判分/答疑接口
      const ans = String(text || '').trim()
      const finalText = (ans.length < 2 || /^(嗯|啊|呃|额|哦|噢|唔|哼|哈|唉|哎)+$/.test(ans)) ? '' : ans
      this.pushText('你的回答：' + (finalText || '（没听清）'), () => {
        api.answer(app.globalData.sessionId, s.id, finalText)
          .then(res => {
            this.answers.push({ step_id: s.id, answer_text: text || '', verdict: res.verdict })
            this.showVerdict(res.verdict, () => {
              const next = res.next_steps || []
              this.queue = this.queue.slice(0, this.i + 1).concat(next, this.queue.slice(this.i + 1))
              this.step(this.i + 1)
            })
          })
          .catch(() => {
            this.answers.push({ step_id: s.id, answer_text: text || '', verdict: 'unknown' })
            this.step(this.i + 1)
          })
      })
    })
  },

  // 答题反馈弹卡：✓绿（正确/已记录）/ ⚠橙（再想一想），振动反馈，1.1s 后继续
  showVerdict(verdict, cb) {
    const kind = verdict === 'wrong' ? 'orange' : 'green'
    const text = verdict === 'correct' ? '回答正确' : verdict === 'wrong' ? '再想一想' : '已记录'
    wx.vibrateShort({ type: 'light' })
    this.setData({ verdictPop: { kind, text } })
    this.popTimer = setTimeout(() => {
      this.setData({ verdictPop: null })
      cb && cb()
    }, 1100)
  },

  finishSpeak() {   // 说完点一下提前结束；不点则到时自动停
    if (this.data.recording) voice.stop()
  },

  /* ---------- 语音指令（commander 回调） ---------- */
  startCmdListen() {
    if (this.data.cmdOn) return
    const ok = voice.commander.start(a => this.applyAction(a))
    this.setData({ cmdOn: !!ok })
  },

  stopCmdListen() {
    voice.commander.stop()
    this.setData({ cmdOn: false })
  },

  applyAction(a) {
    if (!a || !a.action) return
    switch (a.action) {
      case 'pause':  if (this.data.playing) this.toggle(); break
      case 'resume': if (!this.data.playing) this.toggle(); break
      case 'set_font':   this.bumpFont(a.direction || a.value); break
      case 'set_volume': this.bumpVolume(a.direction || a.value); break
      case 'repeat': this.replay(); break
      case 'ask':    this.tapAsk(); break
      case 'next':
        clearTimeout(this.timer)
        this.rowPlay = null
        this.step(this.i + 1)
        break
      default: break   // none / 未识别：忽略
    }
  },

  bumpFont(dir) {
    const order = ['l', 'xl', 'xxl']
    let i = order.indexOf(this.data.fontSize) + (dir === 'down' ? -1 : 1)
    i = Math.max(0, Math.min(order.length - 1, i))
    if (order[i] === this.data.fontSize) return
    this.setData({ fontSize: order[i] }, () =>
      this.measureLines(() => this.scrollToLine(this.data.idx)))
    wx.showToast({ title: dir === 'down' ? '字体调小' : '字体调大', icon: 'none' })
  },

  bumpVolume(dir) {
    const v = Math.max(0.2, Math.min(2, (app.globalData.volume || 1) + (dir === 'down' ? -0.2 : 0.2)))
    app.globalData.volume = v
    voice.setVolume(v)
    wx.showToast({ title: '音量 ' + v.toFixed(1), icon: 'none' })
  },

  replay() {
    this.events.push({ type: 'repeat', step: this.i, at: Date.now() })   // 重听埋点
    clearTimeout(this.timer)
    const rp = this.rowPlay
    if (rp && this.data.playing) {
      rp.r = 0                  // "再说一遍"= 本步从头播
      voice.replaySay()
      this.tickRow()
    } else {
      this.scrollToLine(this.data.idx)
    }
  },

  toggle() {
    const playing = !this.data.playing
    this.setData({ playing })
    clearTimeout(this.timer)
    if (!playing) {
      voice.pause()
      this.events.push({ type: 'pause', step: this.i, at: Date.now() })   // 暂停埋点
      return          // 暂停时保持指令监听，才能用"继续"唤醒
    }
    voice.resume()
    const rp = this.rowPlay
    if (rp) {
      if (rp.r > 0) rp.r--      // 恢复时把当前行重读一遍，不打断节奏
      this.tickRow()
    }
  },

  /* ---------- 结束 ---------- */
  finish() {
    this.stopCmdListen()
    this.setData({ progress: 100 })
    api.finish(app.globalData.sessionId, this.events)   // 行为埋点随 finish 上送（证据飞轮）
      .then(res => {
        wx.setStorageSync('result', res)
        wx.redirectTo({ url: '/pages/result/result' })
      })
      .catch(() => {
        wx.setStorageSync('result', { score: 0, wrong_items: [] })
        wx.redirectTo({ url: '/pages/result/result' })
      })
  },

  onUnload() {
    clearTimeout(this.timer)
    clearTimeout(this.popTimer)
    clearTimeout(this.splashTimer)
    clearInterval(this.secTimer)
    this.stopCmdListen()
    voice.destroy()
  }
})

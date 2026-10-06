const api = require('./api')
const config = require('../config')

// audio_url 服务端给的是相对路径（/tts/x.mp3）——innerAudioContext 只认完整 URL，
// 不补域名会播放失败、onError 立即推进，整个剧本"秒结束"。插件本地文件（res.filename）不能补
const fullUrl = u => (/^https?:\/\//.test(u) ? u : config.API_BASE + u)

// 语音层：
//   TTS：微信同声传译插件（WechatSI）合成 → innerAudioContext 播，onEnded 驱动剧本推进
//   ASR：WechatSI RecordRecognitionManager 本地识别出文字（答题/指令都只把文字交后端判）
//   降级：插件未添加 → recorderManager + 后端 /api/asr|/api/command 桩，行为不变
let SI = null
try { SI = requirePlugin('WechatSI') } catch (e) { SI = null }
const recog = SI && SI.getRecordRecognitionManager ? SI.getRecordRecognitionManager() : null
const rm = wx.getRecorderManager()

/* ================= TTS ================= */
let iac = null
let sayEnd = null, sayStart = null, sayErr = null

function ensureIac() {
  if (!iac) {
    iac = wx.createInnerAudioContext()
    iac.obeyMuteSwitch = false
    iac.onCanplay(() => { if (sayStart) { const f = sayStart; sayStart = null; f(iac.duration || 0) } })
    iac.onEnded(() => { const f = sayEnd; sayEnd = null; sayErr = null; f && f() })
    // 播放失败优先走 sayErr（调用方可挂"定时器节奏兜底"），没挂才按播完处理——防剧本"秒结束"
    iac.onError(() => { const f = sayErr || sayEnd; sayEnd = null; sayErr = null; f && f() })
  }
  return iac
}

// say(text, {audio_url, speed, volume, onStart(秒), onEnd}) → true=音频驱动；false=纯文本，走定时器降级
// 优先级：服务端预合成 audio_url（阿里 TTS，/api/tts）> WechatSI 插件 > false
function say(text, opt) {
  opt = opt || {}
  if (opt.audio_url) {
    const a = ensureIac()
    a.src = fullUrl(opt.audio_url)
    if (opt.speed) { try { a.playbackRate = opt.speed } catch (e) {} }
    if (opt.volume) { try { a.volume = Math.min(1, opt.volume) } catch (e) {} }
    sayStart = opt.onStart || null
    sayEnd = opt.onEnd || null
    sayErr = opt.onError || null
    a.play()
    return true
  }
  if (!SI) return false
  SI.textToSpeech({
    lang: 'zh_CN',
    tts: true,
    content: String(text || ''),
    success: res => {
      if (!res || !res.filename) return opt.onEnd && opt.onEnd()
      const a = ensureIac()
      a.src = res.filename
      if (opt.speed) { try { a.playbackRate = opt.speed } catch (e) {} }
      if (opt.volume) { try { a.volume = Math.min(1, opt.volume) } catch (e) {} }
      sayStart = opt.onStart || null
      sayEnd = opt.onEnd || null
      sayErr = opt.onError || null
      a.play()
    },
    fail: () => opt.onEnd && opt.onEnd()
  })
  return true
}

/* ================= ASR（插件路径） ================= */
let recMode = null        // 'answer' | 'command' | 'stopping'（丢弃结果）
let recAnswerCb = null
let cmdActive = false, commandCb = null
let lastCmdText = '', lastCmdAt = 0

function sendCmd(text) {
  api.commandText(text)
    .then(r => { if (r && r.action && r.action !== 'none' && commandCb) commandCb(r) })
    .catch(() => {})
}
function throttledCmd(text) {
  const now = Date.now()
  if (!text || text === lastCmdText || now - lastCmdAt < 1500) return
  lastCmdText = text
  lastCmdAt = now
  sendCmd(text)
}

if (recog) {
  // 指令模式：流式中间结果直接节流送匹配——工人说"大点声"不用说完一整片
  recog.onRecognize = res => {
    if (recMode === 'command' && cmdActive) throttledCmd(res && res.result)
  }
  recog.onStop = res => {
    const m = recMode
    recMode = null
    if (m === 'answer' && recAnswerCb) {
      const cb = recAnswerCb
      recAnswerCb = null
      cb((res && res.result) || '')
    } else if (m === 'command') {
      if (res && res.result) sendCmd(res.result)
      if (cmdActive) { recMode = 'command'; recog.start({ duration: 60000, lang: 'zh_CN' }) }
    }
    // 'stopping'：丢弃
  }
  recog.onError = () => {
    const m = recMode
    recMode = null
    if (m === 'answer' && recAnswerCb) {
      const cb = recAnswerCb
      recAnswerCb = null
      cb('')
    } else if (m === 'command' && cmdActive) {
      setTimeout(() => {
        if (cmdActive && !recMode) { recMode = 'command'; recog.start({ duration: 60000, lang: 'zh_CN' }) }
      }, 1000)
    }
  }
}

function startAnswerRecog(cb) {
  if (recMode) {                       // 占用中（多半是 command 刚停）→ 等 onStop 后再起
    try { recog.stop() } catch (e) {}
    return setTimeout(() => startAnswerRecog(cb), 300)
  }
  recAnswerCb = cb
  recMode = 'answer'
  recog.start({ duration: 30000, lang: 'zh_CN' })
}

/* ================= recorderManager 降级通道 ================= */
let mode = null, startMode = null
let answerCb = null
let busyRetry = null
const REC = { sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'wav' }
const ANSWER_REC = { ...REC, duration: 30000 }
const COMMAND_REC = { ...REC, duration: 8000 }
function rec(opts, m) { startMode = m; rm.start(opts) }

rm.onStop(res => {
  const m = startMode
  startMode = null
  if (m === 'answer' && answerCb) {
    const cb = answerCb
    answerCb = null
    // 只清自己的场：别踩掉新开的录音会话——旧会话 onStop 晚到时若误清 mode，
    // 下一次 rm.start 会把正在录的这段掐死（0.08s 废录音 → ASR 出"嗯" → 提问风暴）
    if (mode === 'answer') mode = null
    api.asr(res.tempFilePath).then(r => cb(r.text)).catch(() => cb(''))
  } else if (m === 'command') {
    if (cmdActive && mode === 'command') {
      api.command(res.tempFilePath)
        .then(r => { if (commandCb) commandCb(r) })
        .catch(() => {})
        .finally(() => { if (cmdActive && mode === 'command') rec(COMMAND_REC, 'command') })
    } else if (mode === 'command') {
      mode = null   // 同上：只在自己仍是当前模式时清
    }
  }
})
rm.onError(() => {
  if (startMode === 'answer' && answerCb) {
    const cb = answerCb
    answerCb = null
    if (mode === 'answer') mode = null
    cb('')
  }
})

module.exports = {
  siReady: !!recog,

  // TTS：见上。页面对返回 true 的情况等 onEnd 推进；false 时自己跑定时器
  say,

  // 播放控制（TTS 驱动时才有实际作用；降级时都是 no-op）
  pause() { if (iac) try { iac.pause() } catch (e) {} },
  resume() { if (iac) try { iac.play() } catch (e) {} },
  replaySay() { if (iac && iac.src) { try { iac.seek(0); iac.play() } catch (e) { iac.stop(); iac.play() } } },
  setVolume(v) { if (iac) try { iac.volume = Math.min(1, Math.max(0, v)) } catch (e) {} },
  stopSay() { sayEnd = null; sayStart = null; sayErr = null; if (iac && iac.src) try { iac.stop() } catch (e) {} },

  // 答题录音/识别：cb(text)，text 空串表示失败
  start(cb) {
    if (recog) {
      if (recMode) return false
      startAnswerRecog(cb)
      return true
    }
    if (mode || startMode) {
      // 上一段录音还在异步收尾（stop 不是即时的）——400ms 后重试，
      // 别让新 rm.start 跟它互掐（互掐=新录音 1 秒内暴毙 → 识别成"没听清"）
      if (busyRetry) return true
      busyRetry = setTimeout(() => { busyRetry = null; module.exports.start(cb) }, 400)
      return true
    }
    mode = 'answer'
    answerCb = cb
    rec(ANSWER_REC, 'answer')
    return true
  },
  stop() {
    if (recog) { if (recMode === 'answer') recog.stop(); return }
    if (mode === 'answer') rm.stop()
  },

  // 指令监听：cb(action JSON)。say 步期间开，listen 步必须停（麦克风让给答题）
  commander: {
    start(cb) {
      commandCb = cb
      cmdActive = true
      if (recog) {
        if (recMode) return false
        lastCmdText = ''
        recMode = 'command'
        recog.start({ duration: 60000, lang: 'zh_CN' })
        return true
      }
      if (mode) return false
      mode = 'command'
      rec(COMMAND_REC, 'command')
      return true
    },
    stop() {
      cmdActive = false
      if (recog) {
        if (recMode === 'command') { recMode = 'stopping'; recog.stop() }
        return
      }
      if (mode === 'command') { mode = null; rm.stop() }
    },
    get active() { return cmdActive }
  },

  destroy() {
    cmdActive = false
    if (recog && recMode) { recMode = 'stopping'; try { recog.stop() } catch (e) {} }
    if (mode) { mode = null; try { rm.stop() } catch (e) {} }
    if (iac) { try { iac.destroy() } catch (e) {} iac = null }
  }
}

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CHECKIN_TIME = '09:00'
const CHECKIN_TIMEZONE = 'Asia/Shanghai'
const CHECKIN_RANDOM_RANGE_MINUTES = 30
const MINUTES_PER_DAY = 24 * 60

const padTimePart = (value) => String(value).padStart(2, '0')

export const parseCheckinTime = (value = DEFAULT_CHECKIN_TIME) => {
  const source = String(value || DEFAULT_CHECKIN_TIME).trim()
  const match = source.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!match) {
    throw new Error(`Invalid CHECKIN_TIME "${source}". Expected HH:mm, for example 09:00.`)
  }
  return {
    label: source,
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}

export const getCheckinTimeParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHECKIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    minute: Number(parts.find((part) => part.type === 'minute')?.value),
  }
}

const timeToMinutes = ({ hour, minute }) => hour * 60 + minute

const normalizeMinutes = (minutes) => (
  (minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY
) % MINUTES_PER_DAY

const minutesToTime = (minutes) => {
  const normalized = normalizeMinutes(minutes)
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return {
    hour,
    minute,
    minutes: normalized,
    label: `${padTimePart(hour)}:${padTimePart(minute)}`,
  }
}

export const isCheckinRandomEnabled = (value = process.env.CHECKIN_RANDOM) => (
  String(value || '').trim() === 'true'
)

export const getStableRandomOffset = ({
  dateKey,
  repository = '',
  checkinTime,
  range = CHECKIN_RANDOM_RANGE_MINUTES,
}) => {
  const seed = `${dateKey}|${repository}|${checkinTime}`
  let hash = 2166136261
  for (const char of seed) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return (hash % (range * 2 + 1)) - range
}

export const resolveCheckinTarget = ({
  checkinTime = process.env.CHECKIN_TIME,
  checkinRandom = process.env.CHECKIN_RANDOM,
  repository = process.env.GITHUB_REPOSITORY,
  now = new Date(),
} = {}) => {
  const configured = parseCheckinTime(checkinTime)
  const current = getCheckinTimeParts(now)
  const dateKey = `${current.year}-${padTimePart(current.month)}-${padTimePart(current.day)}`
  const randomEnabled = isCheckinRandomEnabled(checkinRandom)
  const offsetMinutes = randomEnabled
    ? getStableRandomOffset({
      dateKey,
      repository,
      checkinTime: configured.label,
    })
    : 0
  const target = minutesToTime(timeToMinutes(configured) + offsetMinutes)

  return {
    ...target,
    configuredLabel: configured.label,
    dateKey,
    randomEnabled,
    offsetMinutes,
  }
}

export const shouldRunCheckin = ({
  eventName = process.env.GITHUB_EVENT_NAME,
  checkinTime = process.env.CHECKIN_TIME,
  checkinRandom = process.env.CHECKIN_RANDOM,
  repository = process.env.GITHUB_REPOSITORY,
  now = new Date(),
} = {}) => {
  if (eventName !== 'schedule') {
    return { shouldRun: true }
  }

  const target = resolveCheckinTarget({
    checkinTime,
    checkinRandom,
    repository,
    now,
  })
  const current = getCheckinTimeParts(now)
  const currentMinutes = timeToMinutes(current)
  const isDue = currentMinutes >= target.minutes

  if (isDue) {
    return {
      shouldRun: true,
      target,
    }
  }

  const currentLabel = `${padTimePart(current.hour)}:${padTimePart(current.minute)}`
  const targetLabel = target.randomEnabled
    ? `${target.label} (configured ${target.configuredLabel}, offset ${target.offsetMinutes} minutes)`
    : target.label
  return {
    shouldRun: false,
    reason: `Skip checkin: current Beijing time ${currentLabel} is earlier than CHECKIN_TIME ${targetLabel}.`,
  }
}

const glados = async () => {
  const notice = []
  if (!process.env.GLADOS_COOKIE) return
  for (const cookie of String(process.env.GLADOS_COOKIE).split('\n')) {
    if (!cookie) continue
    try {
      const common = {
        'cookie': cookie,
        'referer': 'https://glados.cloud/console/checkin',
        'user-agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)',
      }
      const action = await fetch('https://glados.cloud/api/user/checkin', {
        method: 'POST',
        headers: { ...common, 'content-type': 'application/json' },
        body: '{"token":"glados.cloud"}',
      }).then((r) => r.json())
      if (action?.code) throw new Error(action?.message)
      const status = await fetch('https://glados.cloud/api/user/status', {
        method: 'GET',
        headers: { ...common },
      }).then((r) => r.json())
      if (status?.code) throw new Error(status?.message)
      notice.push(
        'Checkin OK',
        `${action?.message}`,
        `Left Days ${Number(status?.data?.leftDays)}`
      )
    } catch (error) {
      notice.push(
        'Checkin Error',
        `${error}`,
        `<${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}>`
      )
    }
  }
  return notice
}

const splitOptions = (value, separator = /\n/) => String(value || '')
  .split(separator)
  .map((item) => item.trim())
  .filter(Boolean)

const sendPushPlus = async (notice) => {
  if (!process.env.PUSHPLUS_TOKEN) return
  await fetch('https://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: process.env.PUSHPLUS_TOKEN,
      title: notice[0],
      content: notice.join('<br>'),
      template: 'markdown',
    }),
  })
}

const sendWxPusher = async (notice) => {
  if (!process.env.WXPUSHER_TOKEN) return
  const uids = splitOptions(process.env.WXPUSHER_UIDS, /[,\n]/)
  if (!uids.length) {
    throw new Error('WXPUSHER_UIDS is required when WXPUSHER_TOKEN is configured.')
  }
  await fetch('https://wxpusher.zjiecode.com/api/send/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appToken: process.env.WXPUSHER_TOKEN,
      summary: notice[0],
      content: notice.join('<br>'),
      contentType: 3,
      uids,
    }),
  })
}

const getServerChanUrl = (sendkey) => {
  const match = String(sendkey).match(/^sctp(\d+)t/i)
  if (match) {
    return `https://${match[1]}.push.ft07.com/send/${sendkey}.send`
  }
  return `https://sctapi.ftqq.com/${sendkey}.send`
}

const sendServerChan = async (notice) => {
  if (!process.env.SERVERCHAN_SENDKEY) return
  const body = new URLSearchParams({
    text: notice[0],
    desp: notice.join('\n\n'),
  })
  await fetch(getServerChanUrl(process.env.SERVERCHAN_SENDKEY), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
}

const isEnabled = (value) => String(value || '').trim() === 'true'

const sendQyWeixin = async (notice) => {
  if (!process.env.QYWEIXIN_KEY) return
  await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${process.env.QYWEIXIN_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: notice.join('<br>'),
      },
    }),
  })
}

const sendConsoleLog = async (notice) => {
  if (!isEnabled(process.env.CONSOLE_LOG)) return
  for (const line of notice) {
    console.log(line)
  }
}

const writeCheckinMarker = async ({ target }) => {
  if (process.env.GITHUB_EVENT_NAME !== 'schedule' || !process.env.CHECKIN_MARKER_PATH) return
  const markerPath = process.env.CHECKIN_MARKER_PATH
  await mkdir(dirname(markerPath), { recursive: true })
  await writeFile(markerPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY || '',
    dateKey: target?.dateKey || '',
    targetTime: target?.label || '',
    configuredTime: target?.configuredLabel || '',
    randomEnabled: Boolean(target?.randomEnabled),
    offsetMinutes: Number(target?.offsetMinutes || 0),
  }))
}

export const notify = async (notice) => {
  if (!notice) return
  await sendPushPlus(notice)
  await sendWxPusher(notice)
  await sendServerChan(notice)
  await sendQyWeixin(notice)
  await sendConsoleLog(notice)
}

export const main = async () => {
  const checkin = shouldRunCheckin()
  if (!checkin.shouldRun) {
    console.log(checkin.reason)
    return
  }
  const notice = await glados()
  if (!notice?.length) {
    console.log('Skip checkin: GLADOS_COOKIE is not configured or no valid cookie entries were found.')
    return
  }
  await writeCheckinMarker(checkin)
  await notify(notice)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

import type { PlayerTrack } from './useSiteData'
import { normalizeMediaSrc } from '~/utils/media'

/**
 * 悬浮播放器的全局状态。
 *
 * 放 useState 而不是组件内部的 ref：播放器挂在布局层只有一个实例，
 * 但以后正文里的「用这个播放器播放」之类入口也要能改这些值，状态得是全局的。
 * 这里只放可序列化的数据（SSR 的 payload 要能过），音频元素本身由 GlobalPlayer 持有。
 */
export function useAudioPlayer() {
  const tracks = useState<PlayerTrack[]>('gg-player-tracks', () => [])
  const index = useState<number>('gg-player-index', () => 0)
  const playing = useState<boolean>('gg-player-playing', () => false)
  const expanded = useState<boolean>('gg-player-expanded', () => false)
  /** 播放进度 0–1，给悬浮球外圈进度环用 */
  const progress = useState<number>('gg-player-progress', () => 0)
  /** 已播秒数与总时长（秒） */
  const elapsed = useState<number>('gg-player-elapsed', () => 0)
  const duration = useState<number>('gg-player-duration', () => 0)
  const volume = useState<number>('gg-player-volume', () => 0.8)
  /** 循环模式：off 播完暂停（默认）/ one 单曲循环 / list 列表循环 */
  const loopMode = useState<'off' | 'one' | 'list'>('gg-player-loop', () => 'off')

  /**
   * 背景音乐提示气泡：非空时播放器左侧展开一个询问框。
   * 进入文章页会先试一次自动播放，被浏览器拦下（没有用户手势）才弹这个。
   */
  const bgmPrompt = useState<boolean>('gg-player-bgm-prompt', () => false)
  /** 正在尝试自动播放的文章标识；自动播放失败时用它决定要不要弹气泡 */
  const bgmPending = useState<string>('gg-player-bgm-pending', () => '')
  /** 本次会话已处理过的文章标识（自动播放成功 / 用户点播 / 用户关掉），不再重复询问 */
  const bgmHandled = useState<string[]>('gg-player-bgm-handled', () => [])

  const current = computed<PlayerTrack | null>(() => tracks.value[index.value] ?? null)

  /** 歌单更新后从头开始，避免下标越界到不存在的曲目上 */
  function setTracks(list: PlayerTrack[]) {
    // 地址统一规范化：后台手填的歌单地址可能漏了开头的斜杠，不补上音频元素会解析成
    // 相对当前文章的路径（/post/uploads/...）而加载失败；同时让下面的按地址查找能对上
    tracks.value = (Array.isArray(list) ? list : []).map((t) => ({
      ...t,
      src: normalizeMediaSrc(t.src),
    }))
    index.value = 0
    progress.value = 0
    elapsed.value = 0
    duration.value = 0
  }

  /** 切到第 i 首，越界自动绕回 */
  function select(i: number) {
    if (!tracks.value.length) return
    index.value = ((i % tracks.value.length) + tracks.value.length) % tracks.value.length
    progress.value = 0
    elapsed.value = 0
  }

  /**
   * 按音频地址找一首并开始播放。
   * 给正文里的音频入口预留：命中就返回 true，没在歌单里就返回 false（调用方自行回落）。
   */
  function playBySrc(src: string) {
    const wanted = normalizeMediaSrc(src)
    const i = tracks.value.findIndex((t) => t.src === wanted)
    if (i < 0) return false
    select(i)
    playing.value = true
    return true
  }

  function markBgmHandled(key: string) {
    if (key && !bgmHandled.value.includes(key)) bgmHandled.value = [...bgmHandled.value, key]
  }

  /**
   * 进入文章页时请求播放它的背景音乐。
   * 命中歌单就试放一次；浏览器拦下自动播放时，由播放器左侧的气泡询问用户。
   * 同一篇文章本次会话只处理一次：已播过、已问过、已拒绝都不再打扰。
   */
  function requestBgm(key: string, src: string) {
    bgmPrompt.value = false
    // 与歌单同一套规范化，否则文章里存的地址和歌单里存的地址写法不一致就找不到曲目
    const wanted = normalizeMediaSrc(src)
    if (!wanted || bgmHandled.value.includes(key)) return
    const i = tracks.value.findIndex((t) => t.src === wanted)
    if (i < 0) return
    // 正在放的就是这首，不动它
    if (playing.value && index.value === i) return
    select(i)
    bgmPending.value = key
    playing.value = true
  }

  /** 自动播放成功：这篇不再需要询问 */
  function bgmStarted() {
    const key = bgmPending.value
    bgmPending.value = ''
    markBgmHandled(key)
  }

  /** 自动播放被浏览器拦下：展开左侧气泡询问，并记为已处理，避免反复打扰 */
  function bgmBlocked() {
    const key = bgmPending.value
    bgmPending.value = ''
    if (!key || bgmHandled.value.includes(key)) return
    markBgmHandled(key)
    bgmPrompt.value = true
  }

  /** 用户点气泡里的播放按钮 */
  function acceptBgm() {
    bgmPrompt.value = false
    playing.value = true
  }

  /** 用户关掉气泡 */
  function dismissBgm() {
    bgmPrompt.value = false
  }

  /** 控制行最右侧的按钮：轮切 播完暂停 → 单曲循环 → 列表循环 */
  function cycleLoop() {
    loopMode.value = loopMode.value === 'off' ? 'one' : loopMode.value === 'one' ? 'list' : 'off'
  }

  return {
    tracks,
    index,
    playing,
    expanded,
    progress,
    elapsed,
    duration,
    volume,
    loopMode,
    cycleLoop,
    bgmPrompt,
    current,
    setTracks,
    select,
    playBySrc,
    requestBgm,
    bgmStarted,
    bgmBlocked,
    acceptBgm,
    dismissBgm,
  }
}

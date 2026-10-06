import type { PlayerTrack } from './useSiteData'

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

  const current = computed<PlayerTrack | null>(() => tracks.value[index.value] ?? null)

  /** 歌单更新后从头开始，避免下标越界到不存在的曲目上 */
  function setTracks(list: PlayerTrack[]) {
    tracks.value = Array.isArray(list) ? list : []
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
    const i = tracks.value.findIndex((t) => t.src === src)
    if (i < 0) return false
    select(i)
    playing.value = true
    return true
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
    current,
    setTracks,
    select,
    playBySrc,
  }
}

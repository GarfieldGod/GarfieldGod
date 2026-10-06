export default defineEventHandler(() => {
  const row = useDb().prepare('SELECT value FROM site_meta WHERE key = ?').get('site') as
    | { value: string }
    | undefined
  if (!row)
    return {
      title: 'GarfieldGod',
      tagline: "I'm God.",
      url: '',
      tabTitle: '',
      tabTagline: '',
      avatar: '',
      favicon: '',
      playlist: [],
      playerEnabled: true,
    }
  // 歌单地址在这里统一规范化：老数据可能存着漏掉开头斜杠的写法，
  // 前台直接当音频 src 用会解析成相对当前文章的路径而 404
  try {
    return withNormalizedPlaylist(JSON.parse(row.value))
  } catch {
    return { playlist: [], playerEnabled: true }
  }
})
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
  return JSON.parse(row.value)
})
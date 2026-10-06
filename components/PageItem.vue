<script setup lang="ts">
import type { NavPage, Post } from '~/composables/useSiteData'
import { aspectRatioCss, resolveDatePosition, prefetchPost, prefetchPostDetail } from '~/composables/useSiteData'
import { cleanExcerpt, coverSrc, formatDateCn } from '~/utils/pageFormat'
import { thumbSrc } from '~/utils/media'

// 单个条目。卡片外观完全由「条目类型」（page.cardType）决定；
// 「条目显示字段」只决定卡片里显示哪些内容，不会改变卡片形态；
// 外层容器（列表 / 网格）只负责排布，同样不影响卡片形态。
const props = withDefaults(
  defineProps<{
    post: Post
    page: NavPage
    /** 页面 id → 页面标题，用于条目上的所属页面胶囊 */
    pageLabels?: Record<string, string>
  }>(),
  { pageLabels: () => ({}) },
)

const cardType = computed(() => props.page.cardType ?? 'standard')
const fields = computed(() => props.page.itemFields ?? {})

// 字段勾选框只控制显隐：勾了「封面图」且文章确有封面时才出图
const showCover = computed(() => fields.value.cover !== false && !!props.post.featured)

// 封面地址：老数据是裸文件名、新上传是 /uploads/... 完整路径，交给 coverSrc 统一成可用地址
const coverUrl = computed(() => coverSrc(props.post.featured))

// 只有「叠加卡」与「网格卡」会把封面铺满整张卡，卡宽随容器与列数变化。
// 容器内容宽约 1050px（--gg-max 1100 减去左右内边距），单列时整卡就有这么宽；
// 720 档缩略图铺上去等于放大近 1.5 倍，在 2 倍屏上要 2100px，实际放大近 3 倍，会明显发虚。
// 所以按估算显示宽度选档：宽过 520px 的卡取 1600 档；其余卡型（图坑本身只有 170–300px）
// 与多列窄卡继续用 720 档，不为看不清的细节多付体积。
const coverWidth = computed<720 | 1600>(() => {
  if (cardType.value !== 'overlay' && cardType.value !== 'mosaic') return 720
  const cols = Math.max(1, props.page.columns || 1)
  return 1050 / cols >= 520 ? 1600 : 720
})
// 原图留给正文；缺对应档位时由 /uploads 路由回落原图，SmartImage 再兜一层
const coverThumb = computed(() => thumbSrc(coverUrl.value, coverWidth.value))

const dateText = computed(() => (fields.value.date ? formatDateCn(props.post.date) : ''))

// 日期位置：仅「全图叠加 / 网格卡」可自定义，其余卡片按各自固定版式渲染
const datePos = computed(() => resolveDatePosition(cardType.value, props.page.datePosition))

// 卡片宽高比：设了就把整张卡按比例定高（高度随宽度走），没设则沿用卡片自带的默认版式
const ratio = computed(() => aspectRatioCss(cardType.value, props.page.aspectRatio))
const cardStyle = computed(() => (ratio.value ? { aspectRatio: ratio.value } : undefined))
const excerptHtml = computed(() =>
  fields.value.excerpt && props.post.excerpt ? normalizeExcerpt(props.post.excerpt) : '',
)

// 极简文字卡的日期栏需要拆成年 + 月/日两行
const dateParts = computed(() => {
  if (!fields.value.date || !props.post.date) return null
  const d = new Date(props.post.date)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return { y: String(d.getFullYear()), m: `${pad(d.getMonth() + 1)} / ${pad(d.getDate())}` }
})

// 所属页面胶囊：按页面树顺序取第一个命中的其它页面
const pillLabel = computed(() => {
  if (!fields.value.categoryPill) return ''
  const order = Object.keys(props.pageLabels).map(Number)
  const ids = props.post.pages.map((p) => p.id)
  for (const id of order) {
    if (ids.includes(id)) return props.pageLabels[String(id)] ?? ''
  }
  return ''
})

// 摘要在卡片链接内渲染，需剥离内部 <a> 以规避嵌套链接与水合报错，
// 同时去掉 WordPress 摘要末尾的「[…]」截断标记
function normalizeExcerpt(html: string) {
  return cleanExcerpt(html).replace(/\[\s*(?:&hellip;|…)\s*\]/gi, '')
}

const itemClasses = computed(() => ({
  'is-plain': !showCover.value,
  'is-nodate': cardType.value === 'editorial' && !dateParts.value,
  'has-ratio': !!ratio.value,
}))

// 预热详情页分两档：
// 1) 进入视口就先取正文——切页时正文是唯一「没有就没东西可渲染」的数据；
// 2) 悬停 / 聚焦再补上阅读数与留言。
// 正文不能只靠悬停：经 Cloudflare 回源一次要 1–5 秒，鼠标移上去到点下去往往只有几百毫秒。
const nuxtApp = useNuxtApp()
const cardEl = ref<unknown>(null)
let observer: IntersectionObserver | undefined

function warmPost() {
  prefetchPost(props.post.id, nuxtApp)
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return
  // NuxtLink 上取到的是组件实例，真正的 DOM 节点在 $el
  const node = ((cardEl.value as { $el?: unknown } | null)?.$el ?? cardEl.value) as unknown
  if (!(node instanceof Element)) return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      prefetchPostDetail(props.post.id, nuxtApp)
      observer?.disconnect()
      observer = undefined
    },
    // 提前 240px 预热：滚到附近时请求已在路上，点下去通常已经命中
    { rootMargin: '240px 0px' },
  )
  observer.observe(node)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = undefined
})
</script>

<template>
  <NuxtLink
    ref="cardEl"
    :to="`/post/${props.post.id}`"
    class="gg-item"
    :class="[`gg-item--${cardType}`, itemClasses]"
    :style="cardStyle"
    @mouseenter="warmPost"
    @focusin="warmPost"
  >
    <!-- 全图叠加：图片铺满，信息压在底部渐变上 -->
    <template v-if="cardType === 'overlay'">
      <div v-if="showCover" class="gg-item__media">
        <SmartImage :src="coverThumb" :fallback="coverUrl" :alt="props.post.title" />
      </div>
      <div class="gg-item__grad" />
      <div class="gg-item__overlay">
        <div v-if="pillLabel" class="gg-item__pills"><span class="gg-item__pill">{{ pillLabel }}</span></div>
        <span v-if="dateText && datePos === 'above'" class="gg-item__date gg-item__date--above">{{ dateText }}</span>
        <div class="gg-item__titlerow" :class="{ 'is-inline': datePos === 'inline' }">
          <h3 v-if="fields.title !== false" class="gg-item__title">{{ props.post.title }}</h3>
          <span v-if="dateText && datePos === 'inline'" class="gg-item__date">{{ dateText }}</span>
        </div>
        <div v-if="excerptHtml" class="gg-item__excerpt" v-html="excerptHtml" />
        <span v-if="dateText && datePos === 'below'" class="gg-item__date">{{ dateText }}</span>
      </div>
    </template>

    <!-- 网格卡：图在上、信息在下 -->
    <template v-else-if="cardType === 'mosaic'">
      <div v-if="fields.cover !== false" class="gg-item__media">
        <SmartImage
          v-if="showCover"
          :src="coverThumb"
          :fallback="coverUrl"
          :alt="props.post.title"
        />
        <span v-else class="gg-item__nocover">NO COVER</span>
      </div>
      <div class="gg-item__body">
        <div v-if="pillLabel || (dateText && datePos === 'above')" class="gg-item__meta">
          <span v-if="pillLabel" class="gg-item__pill">{{ pillLabel }}</span>
          <span v-if="dateText && datePos === 'above'" class="gg-item__date">{{ dateText }}</span>
        </div>
        <div class="gg-item__titlerow" :class="{ 'is-inline': datePos === 'inline' }">
          <h3 v-if="fields.title !== false" class="gg-item__title">{{ props.post.title }}</h3>
          <span v-if="dateText && datePos === 'inline'" class="gg-item__date">{{ dateText }}</span>
        </div>
        <div v-if="excerptHtml" class="gg-item__excerpt" v-html="excerptHtml" />
        <span v-if="dateText && datePos === 'below'" class="gg-item__date">{{ dateText }}</span>
      </div>
    </template>

    <!-- 极简文字：无卡片盒子，日期栏居左、缩略图靠右 -->
    <template v-else-if="cardType === 'editorial'">
      <div v-if="dateParts" class="gg-item__datecol">
        <span class="gg-item__year">{{ dateParts.y }}</span>
        <span class="gg-item__md">{{ dateParts.m }}</span>
      </div>
      <div class="gg-item__body">
        <h3 v-if="fields.title !== false" class="gg-item__title">{{ props.post.title }}</h3>
        <div v-if="excerptHtml" class="gg-item__excerpt" v-html="excerptHtml" />
        <div v-if="pillLabel"><span class="gg-item__pill">{{ pillLabel }}</span></div>
      </div>
      <span v-if="showCover" class="gg-item__thumb">
        <SmartImage :src="coverThumb" :fallback="coverUrl" :alt="props.post.title" />
      </span>
    </template>

    <!-- 左图右文：缩略图居左、信息居右 -->
    <template v-else-if="cardType === 'horizontal'">
      <span v-if="showCover" class="gg-item__thumb">
        <SmartImage :src="coverThumb" :fallback="coverUrl" :alt="props.post.title" />
      </span>
      <div class="gg-item__body">
        <div class="gg-item__meta">
          <span v-if="pillLabel" class="gg-item__pill">{{ pillLabel }}</span>
          <span v-if="dateText" class="gg-item__date">{{ dateText }}</span>
        </div>
        <h3 v-if="fields.title !== false" class="gg-item__title">{{ props.post.title }}</h3>
        <div v-if="excerptHtml" class="gg-item__excerpt" v-html="excerptHtml" />
      </div>
    </template>

    <!-- 标准：复刻改造前的列表行卡 -->
    <template v-else>
      <span v-if="showCover" class="gg-item__thumb">
        <SmartImage :src="coverThumb" :fallback="coverUrl" :alt="props.post.title" />
      </span>
      <div class="gg-item__body">
        <div class="gg-item__head">
          <span v-if="fields.title !== false" class="gg-item__title">{{ props.post.title }}</span>
          <span v-if="pillLabel" class="gg-item__pill">{{ pillLabel }}</span>
          <span v-if="dateText" class="gg-item__date">{{ dateText }}</span>
        </div>
        <div v-if="excerptHtml" class="gg-item__excerpt" v-html="excerptHtml" />
      </div>
    </template>
  </NuxtLink>
</template>

<style scoped>
.gg-item {
  text-decoration: none;
  color: inherit;
  border-radius: var(--gg-radius);
  /* 兜底：最窄时宁可裁掉内容，也不让卡片顶出网格单元、压到相邻卡片上 */
  overflow: hidden;
  /* 卡片以「自身宽度」为响应基准：列数是页面配的，视口断点猜不准 */
  container-type: inline-size;
}

/* 摘要：统一去掉内部 <p> 的外边距 */
.gg-item__excerpt :deep(p) { margin: 0; }
.gg-item__excerpt a { display: none; }
/* 长单词（URL、英文串）在窄卡里强制断行，否则会把卡片撑宽 */
.gg-item__excerpt { overflow-wrap: anywhere; }

/* ===== 标准：行卡 ===== */
.gg-item--standard {
  display: flex;
  align-items: flex-start;
  /* 允许换行：窄到放不下时，正文会掉到缩略图下方（见文末容器查询） */
  flex-wrap: wrap;
  gap: 16px;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  padding: 18px 22px;
  transition: transform 0.15s, box-shadow 0.15s;
}
.gg-item--standard:hover { transform: translateX(4px); box-shadow: 0 8px 20px rgba(15, 138, 99, 0.1); }
.gg-item--standard .gg-item__head { display: flex; align-items: center; gap: 10px; }
/* 标题单行省略：换行会把同页卡片撑得高低不一 */
.gg-item--standard .gg-item__title {
  font-weight: 700;
  color: var(--gg-ink);
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gg-item--standard .gg-item__date { margin-left: auto; color: var(--gg-muted); font-size: 0.85rem; }
.gg-item--standard .gg-item__excerpt { color: var(--gg-muted); font-size: 0.9rem; margin: 8px 0 0; }

/* ===== 左图右文 ===== */
.gg-item--horizontal {
  display: grid;
  /* 图片列按 42% 比例封顶：纯 max 300px 会贪婪占满，把文字列挤到极窄。
     两条轨道都可收缩到 0，窄时不会顶出卡片；真正的竖排交给文末容器查询 */
  grid-template-columns: minmax(0, min(300px, 42%)) minmax(0, 1fr);
  gap: 24px;
  align-items: center;
  padding: 16px;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.gg-item--horizontal:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.1);
  border-color: #d2d2d2;
}
.gg-item--horizontal.is-plain { grid-template-columns: minmax(0, 1fr); border-left: 3px solid var(--gg-ink); padding-left: 22px; }
.gg-item--horizontal .gg-item__meta { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
.gg-item--horizontal .gg-item__title { font-family: var(--gg-serif); font-size: 1.5rem; line-height: 1.3; margin: 0 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gg-item--horizontal:hover .gg-item__title { text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1.5px; }
.gg-item--horizontal .gg-item__excerpt {
  margin: 0;
  color: var(--gg-muted);
  font-size: 0.95rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== 极简文字 ===== */
.gg-item--editorial {
  display: grid;
  /* 三条轨道都可收缩到 0：窄时不会顶出卡片，真正的竖排交给文末容器查询 */
  grid-template-columns: minmax(0, 96px) minmax(0, 1fr) minmax(0, 170px);
  gap: 28px;
  align-items: start;
  padding: 24px 6px;
  border-bottom: 1px solid var(--gg-border);
  transition: background 0.2s, padding 0.2s;
}
.gg-item--editorial:hover { background: #f0f0f0; }
/* 无日期栏 / 无缩略图时收缩对应列，避免留空 */
.gg-item--editorial.is-nodate { grid-template-columns: minmax(0, 1fr) minmax(0, 170px); }
.gg-item--editorial.is-plain { grid-template-columns: minmax(0, 96px) minmax(0, 1fr); }
.gg-item--editorial.is-plain.is-nodate { grid-template-columns: minmax(0, 1fr); }
.gg-item--editorial .gg-item__datecol { display: flex; flex-direction: column; line-height: 1.15; padding-top: 4px; }
.gg-item--editorial .gg-item__year { font-family: var(--gg-serif); font-size: 1.35rem; color: var(--gg-ink); }
.gg-item--editorial .gg-item__md { font-size: 0.82rem; color: var(--gg-muted); letter-spacing: 0.04em; }
.gg-item--editorial .gg-item__title { font-family: var(--gg-serif); font-size: 1.6rem; line-height: 1.3; margin: 0 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gg-item--editorial:hover .gg-item__title { text-decoration: underline; text-underline-offset: 5px; text-decoration-thickness: 1.5px; }
.gg-item--editorial .gg-item__excerpt {
  margin: 0 0 10px;
  color: var(--gg-muted);
  font-size: 0.95rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gg-item--editorial .gg-item__thumb { align-self: center; }
.gg-item--editorial .gg-item__thumb img { filter: grayscale(0.35); }
.gg-item--editorial:hover .gg-item__thumb img { filter: grayscale(0); }

/* ===== 网格卡 ===== */
.gg-item--mosaic {
  display: flex;
  flex-direction: column;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}
.gg-item--mosaic:hover { transform: translateY(-4px); box-shadow: 0 16px 34px rgba(0, 0, 0, 0.12); }
.gg-item--mosaic .gg-item__media { aspect-ratio: 16 / 9; }
.gg-item--mosaic .gg-item__body { padding: 18px 20px 20px; display: flex; flex-direction: column; flex: 1; }
/* 设了宽高比：整卡按比例定高，图片区吃掉剩余高度，文字区保持自然高度不被压扁 */
.gg-item--mosaic.has-ratio .gg-item__media { flex: 1 1 auto; min-height: 0; aspect-ratio: auto; }
.gg-item--mosaic.has-ratio .gg-item__body { flex: none; }
.gg-item--mosaic .gg-item__meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
/* 标题固定一行：过长直接省略，避免换行把同页卡片撑得高低不一 */
.gg-item--mosaic .gg-item__title { font-family: var(--gg-serif); font-size: 1.3rem; line-height: 1.3; margin: 0 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gg-item--mosaic:hover .gg-item__title { text-decoration: underline; text-underline-offset: 4px; text-decoration-thickness: 1.5px; }
.gg-item--mosaic .gg-item__excerpt {
  margin: 0;
  color: var(--gg-muted);
  font-size: 0.92rem;
  /* 摘要固定两行高度：只写一行摘要也占两行位置，
     否则同排卡片因摘要行数不同而高低不一（栅格不拉伸行高） */
  min-height: 2lh;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 无封面时用深色块占位，保证网格不塌陷 */
.gg-item--mosaic .gg-item__nocover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #141414;
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.7rem;
  letter-spacing: 0.28em;
}

/* ===== 全图叠加 ===== */
.gg-item--overlay {
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #141414;
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  transition: transform 0.25s, box-shadow 0.25s;
}
.gg-item--overlay:hover { transform: translateY(-4px); box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18); }
/* 图片区铺满整张卡：不够高时放大填满，超出时按原比例裁掉，不缩进卡内留白 */
.gg-item--overlay .gg-item__media { position: absolute; inset: 0; }
.gg-item--overlay .gg-item__grad {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.82) 0%,
    rgba(0, 0, 0, 0.45) 34%,
    rgba(0, 0, 0, 0.05) 62%,
    rgba(0, 0, 0, 0) 100%
  );
}
.gg-item--overlay.is-plain .gg-item__grad {
  background:
    radial-gradient(120% 120% at 15% 0%, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 55%),
    linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.25) 70%);
}
.gg-item--overlay .gg-item__overlay { position: absolute; left: 0; right: 0; bottom: 0; padding: 26px 30px; }
.gg-item--overlay .gg-item__pills { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.gg-item--overlay .gg-item__pill {
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #fff;
}
.gg-item--overlay .gg-item__title {
  font-family: var(--gg-serif);
  font-size: 1.75rem;
  line-height: 1.25;
  margin: 0 0 8px;
  color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
}
/* 摘要默认收起，悬浮时展开两行，保证静止状态是纯图版式 */
.gg-item--overlay .gg-item__excerpt {
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.95rem;
  margin: 0;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease;
}
.gg-item--overlay:hover .gg-item__excerpt { max-height: 3.4em; opacity: 1; margin: 0 0 8px; }
.gg-item--overlay .gg-item__excerpt :deep(p) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gg-item--overlay .gg-item__date { font-size: 0.86rem; color: rgba(255, 255, 255, 0.78); }
.gg-item--overlay .gg-item__date--above { display: block; margin-bottom: 6px; }

/* ===== 公共零件 ===== */
.gg-item__media { overflow: hidden; background: var(--gg-surface-2); flex: none; }
.gg-item__media img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s; }
.gg-item:hover .gg-item__media img { transform: scale(1.05); }
.gg-item__thumb {
  display: block;
  /* 可收缩：窄时让位给文字，而不是把卡片顶宽 */
  flex: 0 1 auto;
  min-width: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--gg-surface-2);
}
.gg-item__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.5s; }
.gg-item:hover .gg-item__thumb img { transform: scale(1.04); }
.gg-item--standard .gg-item__thumb { width: 168px; height: 105px; }
.gg-item--horizontal .gg-item__thumb { width: 100%; aspect-ratio: 16 / 10; }
.gg-item--editorial .gg-item__thumb { width: 100%; aspect-ratio: 16 / 10; }
.gg-item__body { min-width: 0; flex: 1 1 auto; }
.gg-item__title { margin: 0; color: var(--gg-ink); }
.gg-item__pill {
  flex: none;
  display: inline-block;
  font-size: 0.74rem;
  line-height: 1;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--gg-accent-soft);
  border: 1px solid var(--gg-border);
  color: var(--gg-inksoft);
  white-space: nowrap;
}
.gg-item__date { flex: none; color: var(--gg-muted); font-size: 0.82rem; white-space: nowrap; }
/* 标题同排靠右：标题与日期共处一行，日期贴右 */
.gg-item__titlerow.is-inline { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.gg-item__titlerow.is-inline .gg-item__title { min-width: 0; }
.gg-item--overlay .gg-item__titlerow.is-inline .gg-item__title { margin-bottom: 8px; }
.gg-item--mosaic .gg-item__titlerow.is-inline .gg-item__title { margin-bottom: 8px; }

@media (max-width: 720px) {
  .gg-item--overlay { aspect-ratio: 4 / 3; }
  .gg-item--overlay .gg-item__overlay { padding: 18px 20px; }
  .gg-item--overlay .gg-item__title { font-size: 1.35rem; }
  .gg-item--horizontal { grid-template-columns: minmax(0, 140px) minmax(0, 1fr); gap: 16px; padding: 12px; }
  .gg-item--horizontal .gg-item__title { font-size: 1.15rem; }
  .gg-item--horizontal .gg-item__excerpt { -webkit-line-clamp: 1; }
  .gg-item--editorial { grid-template-columns: minmax(0, 64px) minmax(0, 1fr); gap: 16px; padding: 18px 4px; }
  .gg-item--editorial .gg-item__title { font-size: 1.2rem; }
  .gg-item--editorial .gg-item__thumb { display: none; }
  .gg-item--standard .gg-item__thumb { width: 104px; height: 68px; }
}

/* ===== 窄卡片降级：卡片以自身宽度为容器，放不下时由横排改竖排 =====
   @container 只能匹配容器的「后代」，而容器就是 .gg-item 自己，
   所以这里不改 .gg-item 的 display，而是让子元素占满整行来堆叠。
   阈值按「文字列还剩多少」定：横排时文字列窄于约 200px 就竖排，
   即标准 400（-228 家具）/ 左图右文 440（-241 家具）/ 极简文字 520（-334 家具）。 */
@container (max-width: 400px) {
  /* 标准：缩略图独占一行，正文换到下一行 */
  .gg-item--standard .gg-item__thumb { width: 100%; height: auto; aspect-ratio: 16 / 9; }
  .gg-item--standard .gg-item__body { flex: 1 1 100%; }
  .gg-item--standard .gg-item__date { margin-left: 0; }
}
@container (max-width: 440px) {
  /* 左图右文：缩略图与正文各横跨全部轨道，自然分成上下两行 */
  .gg-item--horizontal .gg-item__thumb,
  .gg-item--horizontal .gg-item__body { grid-column: 1 / -1; }
}
@container (max-width: 520px) {
  /* 极简文字：日期栏、正文、缩略图依次堆叠，缩略图提到最上 */
  .gg-item--editorial .gg-item__datecol,
  .gg-item--editorial .gg-item__body,
  .gg-item--editorial .gg-item__thumb { grid-column: 1 / -1; }
  .gg-item--editorial .gg-item__datecol { flex-direction: row; align-items: baseline; gap: 8px; padding-top: 0; }
  .gg-item--editorial .gg-item__thumb { order: -1; }
}
</style>
<script setup lang="ts">
import { usePostDetail, tabName, displayPages, resolvePostStyleOptions, sessionCachedData } from '~/composables/useSiteData'
import type { Comment, PostStyleOptions } from '~/composables/useSiteData'
import {
  resolvePostStyle,
  resolveLinkTarget,
  preparePostContent,
  splitPostSections,
  postTextLength,
  postPlainText,
  markLeadParagraph,
} from '~/utils/postStyle'
import type { LinkTarget, PostHeading } from '~/utils/postStyle'

const route = useRoute()
const id = String(route.params.id)

const { data, error } = await usePostDetail(id)
if (error.value || !data.value?.post) {
  throw createError({ statusCode: 404, message: '文章不存在', fatal: true })
}
const post = data.value!.post
// 所属页面标注里始终不展示「首页」
const pages = displayPages(post.pages)

// 标签页标题：文章名 — 站名（站名独立于导航栏「名称」，来自「站点信息」，后台可改）
const { data: meta } = await useSiteMeta()
useHead({ title: () => `${post.title} — ${tabName(meta.value)}` })

// 原站日期格式："13 9 月, 2023"
function formatDate(d: string) {
  const dt = new Date(d)
  return `${dt.getDate()} ${dt.getMonth() + 1} 月, ${dt.getFullYear()}`
}

// 正文宽度挡位：默认（''）沿用模板宽度，其余按挡位放宽 / 收窄正文与底部元信息
const widthClass = computed(() =>
  ['wide', 'normal', 'narrow'].includes(post.contentWidth ?? '') ? `is-${post.contentWidth}` : '',
)

// ===== 文章样式方案 =====
// '' 默认（原站复刻）/ classic 经典单栏 / toc 左文右栏 / magazine 杂志大图 / cards 分节卡片
const postStyle = resolvePostStyle(post.postStyle)
const styleOptions: PostStyleOptions = resolvePostStyleOptions(post.postStyleOptions)
const postStyleClass = computed(() => (postStyle ? `post-style-${postStyle}` : ''))

// 正文一次处理：补标题锚点 id + 抽出目录 + 按 h2 切小节。
// 全部是纯字符串运算，服务端与客户端结果一致，不会触发 hydration 不匹配。
const rawContent = post.html ?? post.content ?? ''
const prepared = preparePostContent(rawContent)
const split = splitPostSections(prepared)
const tocHeadings: PostHeading[] = prepared.headings
const cardHeadings = split.sections.map((s) => ({ id: s.id, text: s.text, level: 2 as const }))
const readMinutes = Math.max(1, Math.round(postTextLength(rawContent) / 350))

/** 正文首个段落，用于摘要缺失时的引文兜底 */
function firstParagraphText(html: string) {
  const m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)
  return m ? postPlainText(m[1]) : ''
}
// 摘要字段在库里常是带 <p> 的 HTML，必须先转纯文本，否则引文里会把标签原样显示出来
const lede = postPlainText(post.excerpt ?? '') || firstParagraphText(prepared.html)

/** 所属页面串，用作各方案的分类标注 */
const pageLabel = pages.map((p) => p.title).join(' · ') || '未分类'

// 杂志大图：给首个段落打上 lead 类，用于首字下沉
const magazineHtml = markLeadParagraph(prepared.html)

// ===== 方案 E：超链接（中转页） =====
// 跳转目标：只放行 http / https。地址为空、协议不在白名单、或指向本站本文的，
// 一律当作「未配置」，前台静默回落成单栏正文——宁可当普通文章显示，也不能白屏。
// （作者能在后台右栏预览里看到对应提示。）
const linkTarget = computed<LinkTarget | null>(() => {
  if (postStyle !== 'link') return null
  const target = resolveLinkTarget(styleOptions)
  if (!target) return null

  // 指向本站同一篇文章就放弃：否则点进来会被自己再跳一次，原地打转
  const site = (meta.value?.url ?? '').trim()
  if (site) {
    try {
      const to = new URL(target.url)
      const base = new URL(site)
      if (to.origin === base.origin && to.pathname.replace(/\/+$/, '') === `/post/${id}`) return null
    } catch {
      // 站点地址本身不合法，跳过这层判断
    }
  }
  return target
})

// 中转页只是跳板，不该被搜索引擎收录
useHead(() => ({ meta: linkTarget.value ? [{ name: 'robots', content: 'noindex, nofollow' }] : [] }))

const linkCancelled = ref(false)
// 初值直接取设定秒数，别用 0：服务端渲染的那一版也会带这个数字，
// 否则首帧会闪一下「0 秒后自动跳转」，而且初值由同一份数据算出来，
// 服务端与客户端一致，不会有水合不匹配。
const countdown = ref(linkTarget.value?.delay ?? 0)
let linkTimer: ReturnType<typeof setInterval> | undefined

/** 用户自己做了选择（点了按钮 / 点了「留在此页」），就别再自动跳了 */
function cancelAutoJump() {
  linkCancelled.value = true
  if (linkTimer) {
    clearInterval(linkTimer)
    linkTimer = undefined
  }
}

onMounted(() => {
  const target = linkTarget.value
  if (!target || target.delay <= 0) return
  linkTimer = setInterval(() => {
    if (linkCancelled.value) return
    countdown.value -= 1
    if (countdown.value > 0) return
    clearInterval(linkTimer)
    linkTimer = undefined
    // 用 replace 而不是给 href 赋值：不把中转页写进历史记录。
    // 否则用户按返回键会退回这里、然后又被跳走，返回键等于失灵。
    window.location.replace(target.url)
  }, 1000)
})

onBeforeUnmount(() => {
  if (linkTimer) clearInterval(linkTimer)
})

// ===== 阅读数 =====
// SSR 先取当前值渲染，客户端挂载后再 +1，避免服务端渲染触发计数
const { data: viewData } = await useFetch<{ post: number; views: number }>(`/api/views/${id}`, {
  key: `views:${id}`,
  getCachedData: sessionCachedData,
})
const views = ref(viewData.value?.views ?? 0)

// ===== 方案自带的滚动效果 =====
const topProgress = ref(0) // classic：页面顶部进度条 0~1
const railProgress = ref(0) // toc：卡片内阅读进度 0~100
const miniProgress = ref(0) // cards：迷你导航进度 0~100
const activeHeading = ref('') // toc / cards：当前阅读到的小节
const tocCard = ref<HTMLElement | null>(null)

/** 当前小节：取最后一个已滚过 140px 阈值的标题 */
function currentHeading(list: { id: string }[]) {
  let cur = ''
  for (const h of list) {
    const el = document.getElementById(h.id)
    if (el && el.getBoundingClientRect().top <= 140) cur = h.id
  }
  return cur
}

function onScroll() {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (postStyle === 'classic') {
    topProgress.value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
    return
  }
  if (postStyle === 'toc') {
    const el = tocCard.value
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY
      const span = el.offsetHeight - window.innerHeight
      const p = span > 0 ? (window.scrollY - top) / span : 0
      railProgress.value = Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10
    }
    activeHeading.value = currentHeading(tocHeadings)
    return
  }
  if (postStyle === 'cards') {
    miniProgress.value =
      max > 0 ? Math.round(Math.min(1, Math.max(0, window.scrollY / max)) * 1000) / 10 : 0
    activeHeading.value = currentHeading(cardHeadings)
  }
}

onMounted(async () => {
  try {
    const res = await $fetch<{ post: number; views: number }>(`/api/views/${id}`, { method: 'POST' })
    views.value = res.views
  } catch {
    // 计数失败不影响正文阅读
  }
})

onMounted(() => {
  if (!postStyle) return
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
})

// ===== 留言 =====
const { data: commentData, refresh: refreshComments } = await useFetch<{ comments: Comment[] }>(
  '/api/comments',
  {
    key: `comments:${id}`,
    query: { post: id },
    default: () => ({ comments: [] }),
    getCachedData: sessionCachedData,
  },
)
const comments = computed(() => commentData.value.comments)

// 历史留言以 HTML 段落入库，新留言为纯文本；统一转纯文本后由模板转义渲染
function toPlainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatCommentDate(d: string) {
  const dt = new Date(d)
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`
}

function avatarText(author: string) {
  return (author.trim() || '匿名').slice(0, 1)
}

const form = reactive({ author: '', email: '', content: '' })
const submitting = ref(false)
const formError = ref('')
const formOk = ref(false)

async function submitComment() {
  formError.value = ''
  formOk.value = false
  submitting.value = true
  try {
    await $fetch('/api/comments', {
      method: 'POST',
      body: {
        post: Number(id),
        author: form.author,
        email: form.email,
        content: form.content,
      },
    })
    form.author = ''
    form.email = ''
    form.content = ''
    formOk.value = true
    await refreshComments()
  } catch (e: any) {
    formError.value =
      e?.data?.message || e?.data?.statusMessage || e?.message || '提交失败，请稍后再试。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <article class="post-page" :class="[widthClass, postStyleClass]">
    <!-- 顶部阅读进度：仅「经典单栏精修」 -->
    <div v-if="postStyle === 'classic'" class="pg-progress" aria-hidden="true">
      <div class="pg-progress__fill" :style="{ transform: `scaleX(${topProgress})` }" />
    </div>

    <!-- ===== 方案「默认」：原站复刻单栏卡片（保持原样） ===== -->
    <div v-if="postStyle === ''" class="post-page__card">
      <h1 class="post-page__title">{{ post.title }}</h1>

      <hr class="post-page__sep" />

      <div class="post-page__content gg-content" v-html="prepared.html" />

      <div class="post-page__spacer" aria-hidden="true" />

      <hr class="post-page__sep" />

      <div class="post-page__meta">
        <span class="post-page__date">{{ formatDate(post.date) }}</span>
        <span class="post-page__author">Garfield God</span>
        <span class="post-page__pages">
          <template v-for="(pg, i) in pages" :key="pg.id">
            <NuxtLink :to="pg.path">{{ pg.title }}</NuxtLink><template v-if="i < pages.length - 1">, </template>
          </template>
        </span>
        <span class="post-page__views">阅读 {{ views }} 次</span>
      </div>
    </div>

    <!-- ===== 方案 A：经典单栏精修 ===== -->
    <div v-else-if="postStyle === 'classic'" class="pg-card">
      <h1 class="pg-title">{{ post.title }}</h1>
      <p v-if="lede" class="pg-lede">{{ lede }}</p>

      <hr class="pg-rule" />

      <div class="pg-body pg-body--a gg-content" v-html="prepared.html" />

      <hr class="pg-rule" />

      <div class="pg-meta">
        <span class="pg-meta__date">{{ formatDate(post.date) }}</span>
        <span>Garfield God</span>
        <span class="pg-meta__pages">
          <template v-for="(pg, i) in pages" :key="pg.id">
            <NuxtLink :to="pg.path">{{ pg.title }}</NuxtLink><template v-if="i < pages.length - 1">, </template>
          </template>
        </span>
        <span class="pg-meta__views">阅读 {{ views }} 次</span>
      </div>
    </div>

    <!-- ===== 方案 B：左文右栏（目录 / 阅读进度） ===== -->
    <div v-else-if="postStyle === 'toc'" class="pg-wrap">
      <article ref="tocCard" class="pg-card pg-card--toc">
        <p class="pg-kicker">
          <b>{{ pageLabel }}</b>
          <span>{{ formatDate(post.date) }}</span>
          <span>· 约 {{ readMinutes }} 分钟</span>
        </p>
        <h1 class="pg-title pg-title--b">{{ post.title }}</h1>
        <p v-if="lede" class="pg-lede pg-lede--b">{{ lede }}</p>

        <hr class="pg-rule pg-rule--b" />

        <div class="pg-layout" :class="`pg-layout--${styleOptions.tocSide}`">
          <div class="pg-body pg-body--b gg-content" v-html="prepared.html" />

          <aside class="pg-rail">
            <div v-if="tocHeadings.length" class="pg-rail__box">
              <p class="pg-rail__label">本页目录</p>
              <nav class="pg-toc">
                <a
                  v-for="h in tocHeadings"
                  :key="h.id"
                  class="pg-toc__item"
                  :class="{ 'pg-toc__item--sub': h.level === 3, 'is-active': activeHeading === h.id }"
                  :href="`#${h.id}`"
                >{{ h.text }}</a>
              </nav>
            </div>

            <div v-if="styleOptions.tocProgress" class="pg-rail__box">
              <p class="pg-rail__label">阅读进度</p>
              <div class="pg-prog"><div class="pg-prog__fill" :style="{ width: `${railProgress}%` }" /></div>
              <p class="pg-prog__num">{{ Math.round(railProgress) }}% · 全文约 {{ readMinutes }} 分钟</p>
            </div>

            <div v-if="pages.length || post.tags.length" class="pg-rail__box">
              <p class="pg-rail__label">本文归类</p>
              <p class="pg-rail__pages">
                <NuxtLink v-for="pg in pages" :key="pg.id" :to="pg.path" class="pg-rail__link">{{ pg.title }}</NuxtLink>
              </p>
              <p v-if="post.tags.length" class="pg-rail__tags">
                <span v-for="t in post.tags" :key="t.id" class="pg-rail__tag">{{ t.name }}</span>
              </p>
            </div>
          </aside>
        </div>
      </article>
    </div>

    <!-- ===== 方案 C：杂志大图 ===== -->
    <template v-else-if="postStyle === 'magazine'">
      <section class="pg-hero" :class="`pg-hero--${styleOptions.heroSize}`">
        <div
          class="pg-hero__img"
          :style="styleOptions.heroImage ? { backgroundImage: `url(${styleOptions.heroImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined"
          aria-hidden="true"
        />
        <div class="pg-hero__scrim" aria-hidden="true" />
        <div class="pg-hero__inner">
          <span class="pg-hero__chip">{{ pageLabel }}</span>
          <h1 class="pg-hero__title">{{ post.title }}</h1>
          <p v-if="lede" class="pg-hero__lede">{{ lede }}</p>
        </div>
      </section>

      <article class="pg-sheet">
        <div class="pg-byline">
          <span class="pg-byline__avatar" aria-hidden="true">G</span>
          <div class="pg-byline__id">
            <strong>Garfield God</strong>
            <span>{{ formatDate(post.date) }} · 约 {{ readMinutes }} 分钟读完</span>
          </div>
          <span class="pg-byline__right">阅读 {{ views }} 次</span>
        </div>

        <div class="pg-body pg-body--c gg-content" v-html="magazineHtml" />
      </article>
    </template>

    <!-- ===== 方案 D：分节卡片 ===== -->
    <template v-else-if="postStyle === 'cards'">
      <div v-if="styleOptions.miniNav" class="pg-mini">
        <div class="pg-mini__inner">
          <span class="pg-mini__title">{{ post.title }}</span>
          <nav v-if="cardHeadings.length" class="pg-mini__chips">
            <a
              v-for="h in cardHeadings"
              :key="h.id"
              class="pg-chip"
              :class="{ 'is-active': activeHeading === h.id }"
              :href="`#${h.id}`"
            >{{ h.text }}</a>
          </nav>
        </div>
        <div class="pg-mini__prog"><i :style="{ width: `${miniProgress}%` }" /></div>
      </div>

      <article class="pg-stack">
        <section class="pg-card pg-card--head">
          <div class="pg-chips">
            <span class="pg-pill pg-pill--dark">{{ pageLabel }}</span>
            <span v-for="t in post.tags" :key="t.id" class="pg-pill">{{ t.name }}</span>
          </div>
          <h1 class="pg-title pg-title--d">{{ post.title }}</h1>
          <p v-if="lede" class="pg-lede pg-lede--d">{{ lede }}</p>
          <div class="pg-meta pg-meta--head">
            <span class="pg-meta__date">{{ formatDate(post.date) }}</span>
            <span>Garfield God</span>
            <span>约 {{ readMinutes }} 分钟</span>
            <span>阅读 {{ views }} 次</span>
          </div>
        </section>

        <section v-if="split.intro" class="pg-card">
          <div class="pg-sec__body gg-content" v-html="split.intro" />
        </section>

        <section v-for="(s, i) in split.sections" :key="s.id" class="pg-card">
          <p v-if="styleOptions.sectionNumbers" class="pg-sec__no">第 {{ i + 1 }} 节</p>
          <h2 :id="s.id" class="pg-sec__t">{{ s.text }}</h2>
          <div class="pg-sec__body gg-content" v-html="s.html" />
        </section>
      </article>
    </template>

    <!-- ===== 方案 E：超链接（中转页） ===== -->
    <template v-else-if="postStyle === 'link'">
      <!-- 配了合法地址：先停这一页再跳出去，给一句「这是去哪」和一次反悔的机会 -->
      <div v-if="linkTarget" class="pg-card pg-link">
        <span class="pg-link__badge">即将离开本站</span>
        <h1 class="pg-link__title">{{ post.title }}</h1>

        <!-- 正文紧跟在标题下方，就是这篇文章的说明；没写正文时才退回到摘要当一句话简介 -->
        <div v-if="prepared.html.trim()" class="pg-link__note gg-content" v-html="prepared.html" />
        <p v-else-if="lede" class="pg-link__lede">{{ lede }}</p>

        <hr class="pg-rule" />

        <p class="pg-link__status">
          <template v-if="linkTarget.delay > 0 && !linkCancelled">
            正在跳转到 <b>{{ linkTarget.host }}</b>…
          </template>
          <template v-else>请点击下方按钮前往目标页面</template>
        </p>

        <a
          class="pg-link__btn"
          :href="linkTarget.url"
          target="_blank"
          rel="noopener noreferrer nofollow"
          @click="cancelAutoJump"
        >
          立即前往 <span aria-hidden="true">↗</span>
        </a>

        <p class="pg-link__url">{{ linkTarget.url }}</p>

        <p v-if="linkTarget.delay > 0 && !linkCancelled" class="pg-link__timer">
          <span aria-hidden="true">{{ countdown }} 秒后自动跳转</span>
          ·
          <button type="button" class="pg-link__stay" @click="cancelAutoJump">留在此页</button>
        </p>
      </div>

      <!-- 没填地址 / 协议不合法：静默回落成单栏正文，不白屏也不给读者看作者的手误 -->
      <div v-else class="pg-card pg-link__plain">
        <h1 class="pg-link__title">{{ post.title }}</h1>

        <hr class="pg-rule" />

        <div class="pg-body pg-body--a gg-content" v-html="prepared.html" />
      </div>
    </template>

    <!-- 评论区：所有方案共用，位于文章卡片之外、浅灰页面之上；文章可以整体关掉留言 -->
    <section v-if="post.allowComments" class="comments">
      <hr class="comments__sep" />

      <h2 class="comments__title">{{ comments.length }} 条回复</h2>

      <ol class="comments__list">
        <li v-for="c in comments" :key="c.id" class="comment">
          <div class="comment__card">
            <div class="comment__avatar" aria-hidden="true">{{ avatarText(c.author) }}</div>
            <div class="comment__body">
              <div class="comment__head">
                <span class="comment__author">{{ c.author.trim() || '匿名' }}</span>
                <time class="comment__date">{{ formatCommentDate(c.date) }}</time>
              </div>
              <hr class="comment__sep-inner" />
              <p class="comment__content">{{ toPlainText(c.content) }}</p>
              <hr class="comment__sep-inner" />
            </div>
          </div>
        </li>
      </ol>

      <p v-if="!comments.length" class="comments__empty">还没有留言，来说点什么吧。</p>

      <form class="comment-form" @submit.prevent="submitComment">
        <h3 class="comment-form__title">留言</h3>

        <div class="comment-form__row">
          <label class="comment-form__field">
            <span class="comment-form__label">昵称 *</span>
            <input v-model="form.author" type="text" maxlength="40" required />
          </label>
          <label class="comment-form__field">
            <span class="comment-form__label">邮箱（可选，不公开）</span>
            <input v-model="form.email" type="email" maxlength="120" />
          </label>
        </div>

        <label class="comment-form__field">
          <span class="comment-form__label">内容 *</span>
          <textarea v-model="form.content" rows="5" maxlength="2000" required />
        </label>

        <p v-if="formError" class="comment-form__msg is-error">{{ formError }}</p>
        <p v-else-if="formOk" class="comment-form__msg is-ok">留言已提交。</p>

        <button class="comment-form__submit" type="submit" :disabled="submitting">
          {{ submitting ? '提交中…' : '提交' }}
        </button>
      </form>
    </section>
  </article>
</template>

<style scoped>
/* ===== 方案「默认」：复刻原站 twentytwentytwo 单篇文章模板 =====
   页面左右留 max(1.25rem,5vw) 外边距，白色圆角卡片铺满其余宽度 */
.post-page {
  padding: 1.5rem max(1.25rem, 5vw) 0;
  /* 正文宽度挡位：默认沿用模板的 650px，其余挡位改写这一个变量即可 */
  --post-w: 650px;
}
.post-page.is-wide { --post-w: 1000px; }
.post-page.is-normal { --post-w: 800px; }
.post-page.is-narrow { --post-w: 460px; }
.post-page__card {
  background: #ffffff;
  border-radius: 15px;
  padding: 22.5px max(1.25rem, 5vw);
  color: #000000;
  font-size: 1.125rem;
  line-height: 1.6;
}

/* 标题：原站 post-title（h2 gigantic 衬线），居中，下间距 spacing--medium */
.post-page__title {
  font-family: var(--gg-serif);
  font-size: clamp(2.75rem, 6vw, 3.25rem);
  font-weight: 300;
  line-height: 1.15;
  text-align: center;
  color: #000000;
  margin: 0 0 clamp(2rem, 8vw, 96px);
}

/* 分隔线：2px 实线、opacity .4、alignwide（卡片内容宽内满宽） */
.post-page__sep {
  border: none;
  border-bottom: 2px solid #808080;
  opacity: 0.4;
  max-width: 1000px;
  margin: 0 auto;
}

/* 正文：原站 content-size 650px 居中（宽度挡位改写 --post-w） */
.post-page__content {
  max-width: var(--post-w);
  margin: 1.5rem auto 0;
}

/* 让宽度挡位真正生效：全局 .gg-content > * 会把每个正文块压到 720px，
   宽幅（1000px）/ 正常（800px）因此被截短、提前换行；此处用更高优先级
   （两个类 + scoped 属性）把块宽交还给 --post-w。pre / table / blockquote
   等全局规则同样被覆盖。页面静态正文不含这两个类，仍沿用全局 720px。 */
.post-page__content.gg-content > * {
  max-width: 100%;
}

/* 原站正文块间距：margin-block-start 1.5rem、end 0 */
.post-page__content :deep(p),
.post-page__content :deep(ul),
.post-page__content :deep(ol),
.post-page__content :deep(figure),
.post-page__content :deep(blockquote) {
  margin: 1.5rem 0 0;
}
.post-page__content :deep(h1),
.post-page__content :deep(h2) {
  font-family: var(--gg-serif);
  font-size: clamp(2.75rem, 6vw, 3.25rem);
  font-weight: 300;
  line-height: 1.2;
  margin: 1.5rem 0 0;
}
.post-page__content :deep(h3) {
  font-family: var(--gg-serif);
  font-size: clamp(2.25rem, 4vw, 2.75rem);
  font-weight: 300;
  line-height: 1.15;
  margin: 1.5rem 0 0;
}
.post-page__content :deep(h4) {
  font-family: var(--gg-serif);
  font-weight: 300;
  line-height: 1.15;
  margin: 1.5rem 0 0;
}
.post-page__content :deep(img),
.post-page__content :deep(figure img) {
  border-radius: 0;
}

/* 原站正文末尾 300px 留白 */
.post-page__spacer {
  height: 300px;
  margin-top: 1.5rem;
}

/* 底部元信息：右对齐（日期 / 作者 / 分类 / 阅读数），宽度与正文对齐 */
.post-page__meta {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 24px;
  max-width: var(--post-w);
  margin: 1.5rem auto 0;
  font-size: 1rem;
}
.post-page__date { font-style: italic; font-weight: 400; }
.post-page__pages a { color: #000000; }
.post-page__views { color: #6d6d6d; }

/* ===================================================================
   以下为四种可选方案。全部样式都挂在 .post-style-* 根类下，
   与「默认」互不干扰；正文仍保留 .gg-content 以获得列表 / 表格 / 图片等
   基础排版，再用更高优先级（scoped 属性 + 双类）覆盖字体、间距与代码块配色。
   =================================================================== */

/* 正文块宽：全局 .gg-content > * 会压到 720px，这里交还给各方案自己的行宽 */
.pg-body.gg-content > *,
.pg-sec__body.gg-content > * {
  max-width: 100%;
}

/* 正文间距统一：块与块之间只留上方 1.5rem，首块不留白 */
.pg-body :deep(p),
.pg-body :deep(ul),
.pg-body :deep(ol),
.pg-body :deep(figure),
.pg-body :deep(blockquote),
.pg-sec__body :deep(p),
.pg-sec__body :deep(ul),
.pg-sec__body :deep(ol),
.pg-sec__body :deep(figure),
.pg-sec__body :deep(blockquote) {
  margin: 1.4rem 0 0;
}
.pg-body :deep(ul),
.pg-body :deep(ol),
.pg-sec__body :deep(ul),
.pg-sec__body :deep(ol) {
  padding-left: 1.4rem;
}
.pg-body :deep(li),
.pg-sec__body :deep(li) {
  margin: 0.4rem 0 0;
}
.pg-body :deep(> :first-child),
.pg-sec__body :deep(> :first-child) {
  margin-top: 0;
}
.pg-body :deep(figure img),
.pg-body :deep(img) {
  border-radius: 10px;
}
.pg-body :deep(figcaption),
.pg-sec__body :deep(figcaption) {
  margin-top: 10px;
  text-align: center;
  color: var(--gg-muted);
  font-size: 0.85rem;
}

/* 代码：全局 .gg-content pre 是深色，四套方案统一改成浅色描边块 */
.pg-body :deep(pre),
.pg-sec__body :deep(pre) {
  margin: 1.6rem 0 0;
  background: #f4f4f4;
  color: #242424;
  border: 1px solid var(--gg-border);
  border-radius: 10px;
  padding: 16px 18px;
  line-height: 1.62;
  overflow-x: auto;
}
.pg-body :deep(pre code),
.pg-sec__body :deep(pre code) {
  background: none;
  color: inherit;
  padding: 0;
  font-size: 0.86rem;
}
.pg-body :deep(code),
.pg-sec__body :deep(code) {
  font-family: 'JetBrainsMono', Consolas, monospace;
  font-size: 0.9em;
  background: var(--gg-surface-2);
  border-radius: 5px;
  padding: 0.12em 0.38em;
}

/* 分隔线：正文若带 wp 分隔块，收窄一点 */
.pg-body :deep(hr.wp-block-separator) {
  border: none;
  border-top: 1px solid var(--gg-border);
  margin: 2rem auto;
  max-width: 100%;
}

/* 引言：各方案配色不同，这里先给统一底色，方案内再单独覆盖 */
.pg-body :deep(blockquote),
.pg-sec__body :deep(blockquote) {
  padding: 4px 0 4px 20px;
  border-left: 3px solid #000000;
  color: #2f2f2f;
  max-width: 100%;
}
.pg-body :deep(blockquote p),
.pg-sec__body :deep(blockquote p) {
  margin: 0;
}

/* 公共小件 */
.pg-title {
  font-family: var(--gg-serif);
  font-weight: 300;
  color: #000000;
  margin: 0;
}
.pg-lede {
  color: #4a4a4a;
  margin: 0;
}
.pg-rule {
  border: none;
  border-bottom: 2px solid #808080;
  opacity: 0.32;
  margin: clamp(28px, 4vw, 44px) auto;
}
.pg-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 22px;
  font-size: 1rem;
  color: #000000;
}
.pg-meta__date { font-style: italic; }
.pg-meta__pages a { color: #000000; text-decoration: none; }
.pg-meta__views { color: var(--gg-muted); }

/* ---------- 方案 A：经典单栏精修 ---------- */
.post-style-classic { padding: 1.5rem max(1.25rem, 5vw) 0; }
.post-style-classic .pg-card {
  background: #ffffff;
  border-radius: 15px;
  padding: clamp(28px, 4vw, 56px) max(1.25rem, 5vw);
  color: #000000;
  font-size: 1.0625rem;
  line-height: 1.85;
}
.pg-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 80;
  pointer-events: none;
}
.pg-progress__fill {
  height: 100%;
  width: 100%;
  background: #000000;
  transform: scaleX(0);
  transform-origin: 0 50%;
}
.post-style-classic .pg-title {
  font-size: clamp(2.1rem, 5vw, 2.9rem);
  line-height: 1.18;
  text-align: center;
  margin: 0 0 14px;
}
.post-style-classic .pg-lede {
  max-width: 36em;
  margin: 0 auto;
  text-align: center;
  font-size: 1.03rem;
  line-height: 1.75;
}
.pg-body--a {
  max-width: var(--post-w);
  margin: 0 auto;
}
.pg-body--a :deep(h2) {
  font-family: var(--gg-serif);
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 2.6rem 0 0;
}
.pg-body--a :deep(h3) {
  font-family: var(--gg-serif);
  font-size: 1.28rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 2rem 0 0;
  color: #2b2b2b;
}
.post-style-classic .pg-meta {
  justify-content: flex-end;
  max-width: var(--post-w);
  margin: clamp(32px, 5vw, 56px) auto 0;
}

/* ---------- 方案 E：超链接（中转页） ---------- */
/* 列表里点进来先停这一页，再跳去外站：既能交代「这是去哪」，
   也给误点的人一次回头的机会，比从列表直接弹走温和得多 */
.post-style-link { padding: 1.5rem max(1.25rem, 5vw) 0; }
.post-style-link .pg-link,
.post-style-link .pg-link__plain {
  max-width: 880px;
  margin: 0 auto;
  padding: clamp(40px, 4.5vw, 64px) clamp(24px, 4vw, 60px);
  color: #000000;
}
/* 中转页内容通常只有几行，不给下限就会缩成窄窄一条；
   再加上垂直居中，让它看起来像个正经的落地页而不是一张便签 */
.post-style-link .pg-link {
  min-height: clamp(400px, 56vh, 580px);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: center;
  text-align: center;
}
.post-style-link .pg-link__plain { text-align: left; }
.post-style-link .pg-link__badge {
  /* 卡片是 grid，行内元素会被块化撑满整行，所以要显式居中 */
  justify-self: center;
  display: inline-block;
  padding: 6px 14px;
  border-radius: 999px;
  background: #000000;
  color: #ffffff;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
}
.post-style-link .pg-link__title {
  font-family: var(--gg-serif);
  font-weight: 300;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  line-height: 1.25;
  margin: 20px 0 0;
}
/* 回落成普通文章时标题顶格，不再留出胶囊下方的那段间距 */
.post-style-link .pg-link__plain .pg-link__title { margin: 0; }
.post-style-link .pg-link__lede {
  max-width: 34em;
  margin: 14px auto 0;
  color: #4a4a4a;
  font-size: 1.02rem;
  line-height: 1.75;
}
.post-style-link .pg-link__status {
  margin: 0;
  font-size: 1.05rem;
  color: var(--gg-inksoft);
}
.post-style-link .pg-link__btn {
  /* 同上：grid 子项会撑满整行，这里要的不是通栏按钮 */
  justify-self: center;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 22px 0 0;
  padding: 13px 32px;
  border-radius: 999px;
  background: #000000;
  color: #ffffff;
  font-size: 1rem;
  text-decoration: none;
  transition: transform 0.15s, box-shadow 0.15s;
}
.post-style-link .pg-link__btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
}
.post-style-link .pg-link__url {
  margin: 14px 0 0;
  font-size: 0.82rem;
  color: var(--gg-muted);
  /* 长地址不许把卡片撑宽 */
  overflow-wrap: anywhere;
}
.post-style-link .pg-link__timer {
  margin: 12px 0 0;
  font-size: 0.88rem;
  color: var(--gg-muted);
}
.post-style-link .pg-link__stay {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: #000000;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
/* 正文现在紧跟标题，所以不再是「贴底的一段」，而是标题下方的一段说明 */
.post-style-link .pg-link__note {
  max-width: var(--post-w);
  margin: 22px auto 0;
}
.post-style-link .pg-link__note :deep(p) { text-align: left; }

/* ---------- 方案 B：左文右栏（目录 / 阅读进度） ---------- */
.post-style-toc { padding: 1.5rem 24px 0; }
.pg-wrap {
  max-width: 1100px;
  margin: 0 auto;
}
.post-style-toc .pg-card--toc {
  background: #ffffff;
  border-radius: 15px;
  padding: clamp(28px, 4vw, 52px) clamp(22px, 4vw, 48px);
  color: #000000;
  font-size: 1.0625rem;
  line-height: 1.85;
}
.pg-kicker {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 12px;
  font-size: 0.76rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gg-muted);
}
.pg-kicker b { font-weight: 600; color: #000000; }
.post-style-toc .pg-title--b {
  font-size: clamp(1.85rem, 3.4vw, 2.4rem);
  font-weight: 400;
  line-height: 1.22;
  margin: 0 0 12px;
}
.post-style-toc .pg-lede--b {
  max-width: 46em;
  font-size: 1rem;
}
.post-style-toc .pg-rule--b {
  opacity: 0.28;
  margin: clamp(24px, 3vw, 36px) 0 0;
}
.pg-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 236px;
  gap: clamp(28px, 4vw, 56px);
  align-items: start;
  margin-top: clamp(24px, 3vw, 36px);
}
.pg-layout--left { grid-template-columns: 236px minmax(0, 1fr); }
.pg-layout--left .pg-rail { order: -1; }
.pg-body--b { max-width: 720px; }
.pg-body--b :deep(h2) {
  font-family: var(--gg-serif);
  font-size: 1.6rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 2.4rem 0 0;
  scroll-margin-top: 24px;
}
.pg-body--b :deep(h3) {
  font-family: var(--gg-serif);
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 1.8rem 0 0;
  color: #2b2b2b;
  scroll-margin-top: 24px;
}
.pg-rail {
  position: sticky;
  top: 22px;
  display: grid;
  gap: 16px;
}
.pg-rail__box {
  border: 1px solid var(--gg-border);
  border-radius: 12px;
  padding: 14px 16px;
  background: #fafafa;
}
.pg-rail__label {
  margin: 0 0 10px;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gg-muted);
}
.pg-toc {
  display: grid;
  gap: 1px;
  /* 目录一长就会把右栏顶得比视口还高，sticky 贴住顶部之后
     「阅读进度 / 本文归类」两个框永远落在屏幕外，所以限制目录高度让它自己滚 */
  max-height: max(180px, calc(100vh - 300px));
  overflow-y: auto;
  scrollbar-width: thin;
}
.pg-toc__item {
  display: block;
  padding: 7px 10px;
  border-radius: 7px;
  border-left: 2px solid transparent;
  font-size: 0.86rem;
  line-height: 1.45;
  color: var(--gg-inksoft);
  text-decoration: none;
}
.pg-toc__item:hover { background: #f0f0f0; }
.pg-toc__item.is-active {
  background: #ffffff;
  border-left-color: #000000;
  color: #000000;
  font-weight: 600;
}
.pg-toc__item--sub {
  padding-left: 22px;
  font-size: 0.82rem;
  color: var(--gg-muted);
}
.pg-prog {
  height: 6px;
  border-radius: 999px;
  background: var(--gg-surface-2);
  overflow: hidden;
}
.pg-prog__fill {
  height: 100%;
  width: 0;
  background: #000000;
  transition: width 0.12s linear;
}
.pg-prog__num {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--gg-muted);
  font-variant-numeric: tabular-nums;
}
.pg-rail__pages { margin: 0; display: grid; gap: 6px; }
.pg-rail__link {
  font-size: 0.86rem;
  color: #000000;
  text-decoration: none;
}
.pg-rail__link:hover { text-decoration: underline; }
.pg-rail__tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
.pg-rail__tag {
  font-size: 0.76rem;
  color: var(--gg-inksoft);
  background: var(--gg-surface-2);
  border-radius: 999px;
  padding: 3px 10px;
}

/* ---------- 方案 C：杂志大图 ---------- */
.post-style-magazine { padding: 0; }
.pg-hero {
  position: relative;
  height: clamp(260px, 34vw, 400px);
  overflow: hidden;
  background: #000000;
}
.pg-hero--compact { height: clamp(180px, 22vw, 260px); }
.pg-hero--tall { height: clamp(340px, 46vw, 540px); }
.pg-hero__img {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #2f2f2f 0%, #6b6b6b 45%, #a8a8a8 100%);
  background-size: cover;
  background-position: center;
}
.pg-hero__img::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 15% 10%, rgba(255, 255, 255, 0.22), transparent 60%);
}
.pg-hero__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.62));
}
.pg-hero__inner {
  position: relative;
  height: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 0 24px 92px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  color: #ffffff;
}
.pg-hero__chip {
  align-self: flex-start;
  font-size: 0.74rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 999px;
  padding: 4px 12px;
  margin-bottom: 16px;
}
.pg-hero__title {
  font-family: var(--gg-serif);
  font-size: clamp(2rem, 5vw, 3.1rem);
  font-weight: 400;
  line-height: 1.16;
  margin: 0 0 12px;
  max-width: 20em;
  color: #ffffff;
}
.pg-hero__lede {
  font-size: 1.06rem;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.86);
  margin: 0;
  max-width: 40em;
}
.pg-sheet {
  position: relative;
  max-width: 1000px;
  margin: -64px auto 0;
  background: #ffffff;
  border-radius: 15px;
  padding: 0 clamp(22px, 4vw, 48px) clamp(28px, 4vw, 44px);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.1);
}
.pg-byline {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 22px 0;
  border-bottom: 1px solid var(--gg-border);
}
.pg-byline__avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #b4b4b4, #ececec);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #ffffff;
}
.pg-byline__id { display: grid; gap: 2px; }
.pg-byline__id strong { font-size: 0.96rem; }
.pg-byline__id span { font-size: 0.84rem; color: var(--gg-muted); }
.pg-byline__right {
  margin-left: auto;
  font-size: 0.84rem;
  color: var(--gg-muted);
}
.pg-body--c {
  max-width: 100%;
  font-size: 1.15rem;
  line-height: 1.9;
  color: #000000;
}
.pg-body--c :deep(> :first-child) { margin-top: 1.9rem; }
.pg-body--c :deep(p) { margin: 1.5rem 0 0; text-wrap: pretty; }
.pg-body--c :deep(p.lead::first-letter) {
  float: left;
  font-family: var(--gg-serif);
  font-size: 3.7em;
  line-height: 0.8;
  padding: 0.06em 0.1em 0 0;
}
.pg-body--c :deep(h2) {
  font-family: var(--gg-serif);
  font-size: 2rem;
  font-weight: 400;
  line-height: 1.24;
  margin: 3rem 0 0;
}
.pg-body--c :deep(h2::before) {
  content: '';
  display: block;
  width: 46px;
  height: 3px;
  background: #000000;
  margin-bottom: 16px;
}
.pg-body--c :deep(h3) {
  font-family: var(--gg-serif);
  font-size: 1.32rem;
  font-weight: 600;
  line-height: 1.4;
  margin: 2.1rem 0 0;
  color: #2b2b2b;
}
.pg-body--c :deep(blockquote) {
  margin: 2.6rem 0 0;
  padding: 26px 0;
  border: none;
  border-top: 2px solid #000000;
  border-bottom: 2px solid #000000;
  text-align: center;
  color: #000000;
}
.pg-body--c :deep(blockquote p) {
  font-family: var(--gg-serif);
  font-size: clamp(1.3rem, 2.6vw, 1.7rem);
  line-height: 1.55;
}
.pg-body--c :deep(pre) { padding: 18px 20px; }

/* ---------- 方案 D：分节卡片 ---------- */
.post-style-cards { padding: 0; }
.pg-mini {
  position: sticky;
  top: 0;
  z-index: 60;
  background: rgba(246, 246, 246, 0.93);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--gg-border);
}
.pg-mini__inner {
  max-width: 900px;
  margin: 0 auto;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.pg-mini__title {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.pg-mini__chips {
  margin-left: auto;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.pg-mini__chips::-webkit-scrollbar { display: none; }
.pg-chip {
  display: inline-flex;
  white-space: nowrap;
  font-size: 0.8rem;
  color: var(--gg-inksoft);
  background: #ffffff;
  border: 1px solid var(--gg-border);
  border-radius: 999px;
  padding: 5px 12px;
  text-decoration: none;
  transition: 0.15s;
}
.pg-chip:hover { border-color: #b4b4b4; }
.pg-chip.is-active {
  background: #000000;
  border-color: #000000;
  color: #ffffff;
}
.pg-mini__prog { height: 2px; background: transparent; }
.pg-mini__prog i {
  display: block;
  height: 100%;
  width: 0;
  background: #000000;
}
.pg-stack {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  gap: 18px;
}
.pg-card {
  background: #ffffff;
  border-radius: 15px;
}
.pg-card--head {
  padding: 34px clamp(20px, 3vw, 34px) 30px;
}
.pg-stack .pg-card { padding: 26px clamp(20px, 3vw, 34px); }
.pg-stack .pg-card--head { padding: 34px clamp(20px, 3vw, 34px) 30px; }
.pg-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.pg-pill {
  font-size: 0.76rem;
  color: var(--gg-inksoft);
  background: var(--gg-surface-2);
  border-radius: 999px;
  padding: 3px 11px;
}
.pg-pill--dark { background: #000000; color: #ffffff; }
.post-style-cards .pg-title--d {
  font-size: clamp(1.75rem, 3.4vw, 2.25rem);
  font-weight: 400;
  line-height: 1.2;
  margin: 0 0 12px;
}
.post-style-cards .pg-lede--d {
  font-size: 1.01rem;
  max-width: 44em;
}
.pg-meta--head {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--gg-border);
  gap: 18px;
  font-size: 0.88rem;
  color: var(--gg-muted);
}
.pg-sec__no {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--gg-muted);
}
.pg-sec__t {
  font-family: var(--gg-serif);
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.3;
  margin: 6px 0 0;
  scroll-margin-top: 64px;
}
.pg-sec__body {
  max-width: 720px;
  margin-top: 14px;
  font-size: 1.03rem;
  line-height: 1.85;
  color: #000000;
}
.pg-sec__body :deep(> :first-child) { margin-top: 0; }
.pg-sec__body :deep(p) { margin: 1.2rem 0 0; }

/* ===== 评论区（所有方案共用） ===== */
.comments {
  max-width: 1000px;
  margin: 32px auto 0;
}
/* 卡外方案（杂志大图 / 分节卡片）页面本身没有左右留白，评论区自带内边距 */
.post-style-magazine .comments { max-width: 1000px; padding: 0 max(1.25rem, 5vw); }
.post-style-cards .comments { max-width: 900px; padding: 0 24px; }
/* 原站评论组前置 alignwide 分割线 */
.comments__sep {
  border: none;
  border-bottom: 2px solid #808080;
  opacity: 0.4;
  margin: 0 0 32px;
}
.comments__title {
  font-family: var(--gg-serif);
  font-size: 1.35rem;
  font-weight: 600;
  text-align: center;
  color: #000000;
  margin: 0 0 24px;
}
.comments__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 16px;
}
.comments__empty { color: var(--gg-muted); text-align: center; margin: 0 0 24px; }

.comment__card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  background: #ffffff;
  border-radius: 15px;
  padding: 20px 24px;
}
/* 原站头像：50×50、1px 实线边框、直角 */
.comment__avatar {
  flex: none;
  width: 50px;
  height: 50px;
  border: 1px solid #000000;
  background: var(--gg-surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 600;
  color: #000000;
  user-select: none;
}
.comment__body { flex: 1 1 auto; min-width: 0; }
.comment__head { display: grid; gap: 2px; }
.comment__author { font-size: 0.875rem; font-weight: 600; color: #000000; }
.comment__date { font-size: 0.875rem; color: var(--gg-muted); }
.comment__sep-inner {
  border: none;
  border-bottom: 2px solid #808080;
  opacity: 0.4;
  margin: 10px 0;
}
.comment__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 1.0625rem;
  line-height: 1.6;
  color: #000000;
}

/* ===== 留言表单 ===== */
/* 表单比评论列表窄一档并居中，避免输入框被拉得过宽 */
.comment-form {
  max-width: 650px;
  margin: 24px auto 0;
  background: #ffffff;
  border-radius: 15px;
  padding: 24px;
}
.comment-form__title {
  font-family: var(--gg-serif);
  font-size: 1.2rem;
  font-weight: 600;
  text-align: center;
  color: #000000;
  margin: 0 0 18px;
}
/* 昵称 / 邮箱垂直排列；间距交给各字段自身的 margin-bottom，避免叠加出双倍空隙 */
.comment-form__row { display: block; }
.comment-form__field { display: grid; gap: 6px; margin-bottom: 16px; }
.comment-form__label { font-size: 0.875rem; color: var(--gg-inksoft); }
.comment-form input,
.comment-form textarea {
  font: inherit;
  font-size: 1rem;
  color: var(--gg-ink);
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  padding: 10px 12px;
  width: 100%;
  resize: vertical;
}
.comment-form input:focus,
.comment-form textarea:focus {
  outline: none;
  border-color: var(--gg-ink);
}
.comment-form__msg { font-size: 0.9rem; margin: 0 0 14px; }
.comment-form__msg.is-error { color: #c0392b; }
.comment-form__msg.is-ok { color: #1a7f4b; }
.comment-form__submit {
  display: block;
  margin: 0 auto;
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  color: #ffffff;
  background: #000000;
  border: 1px solid #000000;
  border-radius: 999px;
  padding: 10px 28px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.comment-form__submit:hover:not(:disabled) { opacity: 0.85; }
.comment-form__submit:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 980px) {
  .pg-layout,
  .pg-layout--left { grid-template-columns: minmax(0, 1fr); }
  .pg-layout--left .pg-rail { order: 0; }
  .pg-rail {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pg-rail__box:last-child { grid-column: span 2; }
}
@media (max-width: 760px) {
  .pg-sheet { margin-top: -40px; border-radius: 12px; }
  .pg-hero__inner { padding-bottom: 64px; }
  .pg-body--c { font-size: 1.05rem; }
}
@media (max-width: 720px) {
  .post-page__title { margin-bottom: 2rem; }
  .post-page__spacer { height: 120px; }
  .comment__card { padding: 16px; gap: 12px; }
  .post-style-classic .pg-card { padding: 28px 20px; }
  .post-style-classic .pg-title { font-size: 2rem; }
  .pg-body--a :deep(h2) { font-size: 1.5rem; }
  .post-style-toc { padding: 1.5rem 16px 0; }
  .post-style-toc .pg-title--b { font-size: 1.75rem; }
  .pg-rail { grid-template-columns: minmax(0, 1fr); }
  .pg-rail__box:last-child { grid-column: auto; }
}
@media (max-width: 700px) {
  .pg-mini__title { display: none; }
  .pg-mini__chips { margin-left: 0; }
  .pg-stack { padding: 16px; }
  .post-style-cards .pg-title--d { font-size: 1.7rem; }
  .post-style-cards .comments { padding: 0 16px; }
}
</style>

<script setup lang="ts">
// 后台文章编辑页右侧的「效果预览」。
// 文章不感知自己在各个页面里长什么样，只感知自己的详情页长什么样，
// 因此这里直接复刻 pages/post/[id].vue 的文章卡片：标题 + 正文 + 底部元信息，
// 并按「文章样式」渲染对应的四种方案（默认 / 经典单栏精修 / 左文右栏 / 杂志大图 / 分节卡片）。
// 预览是静态缩略图：滚动进度条 / 迷你导航 / 目录高亮统一给一个固定值展示形态，
// 不挂滚动监听，也就不需要 SSR 与水合的一致性处理。
import { resolvePostStyleOptions } from '~/composables/useSiteData'
import type { PostStyleOptions } from '~/composables/useSiteData'
import {
  resolvePostStyle,
  resolveLinkTarget,
  preparePostContent,
  splitPostSections,
  postTextLength,
  postPlainText,
  markLeadParagraph,
} from '~/utils/postStyle'
import { thumbSrc } from '~/utils/media'

const props = withDefaults(
  defineProps<{
    title?: string
    contentHtml?: string
    date?: string
    /** 所属页面标题，按展示页面勾选顺序 */
    pageLabels?: string[]
    /** 草稿时在预览里标注出来 */
    isDraft?: boolean
    /** 正文宽度挡位：'' 默认 / wide 宽幅 / normal 正常 / narrow 窄幅 */
    contentWidth?: string
    /** 文章样式：'' 默认 / classic / toc / magazine / cards */
    postStyle?: string
    /** 文章样式对应的设置项 */
    postStyleOptions?: Partial<PostStyleOptions> | null
  }>(),
  {
    title: '',
    contentHtml: '',
    date: '',
    pageLabels: () => [],
    isDraft: false,
    contentWidth: '',
    postStyle: '',
    postStyleOptions: null,
  },
)

// 宽度挡位只改写一个变量：正文与底部元信息跟着收放，卡片本身宽度不变，
// 这样四种挡位在同一张画布上能直接比出宽窄
const widthClass = computed(() =>
  ['wide', 'normal', 'narrow'].includes(props.contentWidth) ? `is-${props.contentWidth}` : '',
)

// ===== 文章样式方案（与前台 pages/post/[id].vue 同一套解析 / 预处理逻辑）=====
const postStyle = computed(() => resolvePostStyle(props.postStyle))
const styleOptions = computed(() => resolvePostStyleOptions(props.postStyleOptions ?? undefined))
const postStyleClass = computed(() => (postStyle.value ? `post-style-${postStyle.value}` : ''))

// 预览是实时的：正文一改就要立刻重算标题锚点与分节，所以全部走 computed
const prepared = computed(() => preparePostContent(props.contentHtml ?? ''))
const split = computed(() => splitPostSections(prepared.value))
const tocHeadings = computed(() => prepared.value.headings)
const cardHeadings = computed(() =>
  split.value.sections.map((s) => ({ id: s.id, text: s.text, level: 2 as const })),
)
const readMinutes = computed(() => Math.max(1, Math.round(postTextLength(props.contentHtml ?? '') / 350)))

function firstParagraphText(html: string) {
  const m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html ?? '')
  return m ? postPlainText(m[1]) : ''
}

// 摘要：正文首个段落，前台是 excerpt 优先，预览里没有摘要字段就用首段
const lede = computed(() => firstParagraphText(prepared.value.html))
const pageLabel = computed(() => props.pageLabels.join(' · ') || '未分类')

// 杂志大图：首个段落打上 lead 类做首字下沉
const magazineHtml = computed(() =>
  styleOptions.value.dropCap ? markLeadParagraph(prepared.value.html) : prepared.value.html,
)

// 超链接：预览只是静态画布，所以只把中转页的外观摆出来，不挂倒计时也不真跳转
const linkTarget = computed(() =>
  postStyle.value === 'link' ? resolveLinkTarget(props.postStyleOptions ?? undefined) : null,
)

// 静态预览里进度条停在一个固定比例，用来展示「有这根进度条」这件事
const PREVIEW_PROGRESS = 35

function formatDate(d: string) {
  const dt = new Date(d)
  if (!d || Number.isNaN(dt.getTime())) return '未设置时间'
  return `${dt.getDate()} ${dt.getMonth() + 1} 月, ${dt.getFullYear()}`
}

// 画布固定 1080px 宽以便复刻前台比例，再按右栏实际可用宽度折算 zoom，
// 让卡片恰好铺满预览框（CSS 里的 zoom 只作首帧兜底）。
const { el: stageEl } = usePreviewFit(1080)
</script>

<template>
  <div class="ppv" :class="widthClass">
    <!-- 固定宽度画布 + zoom：整页按比例缩进窄栏，高度自动跟随内容 -->
    <div ref="stageEl" class="ppv__stage" :class="postStyleClass">
      <span v-if="props.isDraft" class="ppv__draft">草稿</span>

      <!-- ===== 方案「默认」：原站复刻单栏卡片 ===== -->
      <article v-if="postStyle === ''" class="ppv__card">
        <h1 class="ppv__title">{{ props.title || '未命名文章' }}</h1>

        <hr class="ppv__sep" />

        <div v-if="props.contentHtml" class="gg-content ppv__content" v-html="props.contentHtml" />
        <p v-else class="ppv__empty">正文还是空的。</p>

        <div class="ppv__spacer" aria-hidden="true" />

        <hr class="ppv__sep" />

        <div class="ppv__meta">
          <span class="ppv__date">{{ formatDate(props.date) }}</span>
          <span class="ppv__author">Garfield God</span>
          <span v-if="props.pageLabels.length" class="ppv__pages">{{ props.pageLabels.join('，') }}</span>
          <span class="ppv__views">阅读 0 次</span>
        </div>
      </article>

      <!-- ===== 方案 A：经典单栏精修 ===== -->
      <template v-else-if="postStyle === 'classic'">
        <div class="pg-progress" aria-hidden="true">
          <div class="pg-progress__fill" :style="{ transform: `scaleX(${PREVIEW_PROGRESS / 100})` }" />
        </div>

        <div class="pg-card">
          <h1 class="pg-title">{{ props.title || '未命名文章' }}</h1>
          <p v-if="lede" class="pg-lede">{{ lede }}</p>

          <hr class="pg-rule" />

          <div v-if="contentHtml" class="pg-body pg-body--a gg-content" v-html="prepared.html" />
          <p v-else class="ppv__empty">正文还是空的。</p>

          <hr class="pg-rule" />

          <div class="pg-meta">
            <span class="pg-meta__date">{{ formatDate(props.date) }}</span>
            <span>Garfield God</span>
            <span v-if="props.pageLabels.length" class="pg-meta__pages">{{ props.pageLabels.join('，') }}</span>
            <span class="pg-meta__views">阅读 0 次</span>
          </div>
        </div>
      </template>

      <!-- ===== 方案 B：左文右栏（目录 / 阅读进度） ===== -->
      <div v-else-if="postStyle === 'toc'" class="pg-wrap">
        <article class="pg-card pg-card--toc">
          <p class="pg-kicker">
            <b>{{ pageLabel }}</b>
            <span>{{ formatDate(props.date) }}</span>
            <span>· 约 {{ readMinutes }} 分钟</span>
          </p>
          <h1 class="pg-title pg-title--b">{{ props.title || '未命名文章' }}</h1>
          <p v-if="lede" class="pg-lede pg-lede--b">{{ lede }}</p>

          <hr class="pg-rule pg-rule--b" />

          <div class="pg-layout" :class="`pg-layout--${styleOptions.tocSide}`">
            <div v-if="contentHtml" class="pg-body pg-body--b gg-content" v-html="prepared.html" />
            <p v-else class="ppv__empty">正文还是空的。</p>

            <aside class="pg-rail">
              <div v-if="tocHeadings.length" class="pg-rail__box">
                <p class="pg-rail__label">本页目录</p>
                <nav class="pg-toc">
                  <a
                    v-for="h in tocHeadings"
                    :key="h.id"
                    class="pg-toc__item"
                    :class="{ 'pg-toc__item--sub': h.level === 3 }"
                    :href="`#${h.id}`"
                  >{{ h.text }}</a>
                </nav>
              </div>

              <div v-if="styleOptions.tocProgress" class="pg-rail__box">
                <p class="pg-rail__label">阅读进度</p>
                <div class="pg-prog">
                  <div class="pg-prog__fill" :style="{ width: `${PREVIEW_PROGRESS}%` }" />
                </div>
                <p class="pg-prog__num">{{ PREVIEW_PROGRESS }}% · 全文约 {{ readMinutes }} 分钟</p>
              </div>

              <div v-if="props.pageLabels.length" class="pg-rail__box">
                <p class="pg-rail__label">本文归类</p>
                <p class="pg-rail__pages">
                  <span v-for="(l, i) in props.pageLabels" :key="i" class="pg-rail__link">{{ l }}</span>
                </p>
              </div>
            </aside>
          </div>
        </article>
      </div>

      <!-- ===== 方案 C：杂志大图 ===== -->
      <template v-else-if="postStyle === 'magazine'">
        <!-- 挡位 none：整条封面带不显示，标题区改由白卡顶端承载 -->
        <section
          v-if="styleOptions.heroSize !== 'none'"
          class="pg-hero"
          :class="[`pg-hero--${styleOptions.heroSize}`, { 'is-center': styleOptions.centerTitle }]"
        >
          <div
            class="pg-hero__img"
            :style="styleOptions.heroImage ? { backgroundImage: `url(${thumbSrc(styleOptions.heroImage, 1600)})` } : undefined"
            aria-hidden="true"
          />
          <div class="pg-hero__scrim" aria-hidden="true" />
          <div class="pg-hero__inner">
            <span v-if="styleOptions.showLabel" class="pg-hero__chip">{{ pageLabel }}</span>
            <h1 class="pg-hero__title">{{ props.title || '未命名文章' }}</h1>
            <p v-if="lede && styleOptions.showLede" class="pg-hero__lede">{{ lede }}</p>
          </div>
        </section>

        <article
          class="pg-sheet"
          :class="{
            'pg-sheet--nocover': styleOptions.heroSize === 'none',
            'is-center': styleOptions.centerTitle,
          }"
        >
          <div v-if="styleOptions.heroSize === 'none'" class="pg-nocover-head">
            <span v-if="styleOptions.showLabel" class="pg-nocover__chip">{{ pageLabel }}</span>
            <h1 class="pg-nocover__title">{{ props.title || '未命名文章' }}</h1>
            <p v-if="lede && styleOptions.showLede" class="pg-nocover__lede">{{ lede }}</p>
          </div>

          <div v-if="styleOptions.showByline" class="pg-byline">
            <span class="pg-byline__avatar" aria-hidden="true">G</span>
            <div class="pg-byline__id">
              <strong>Garfield God</strong>
              <span>{{ formatDate(props.date) }} · 约 {{ readMinutes }} 分钟读完</span>
            </div>
            <span class="pg-byline__right">阅读 0 次</span>
          </div>

          <div
            v-if="contentHtml"
            class="pg-body pg-body--c gg-content"
            :class="{ 'pg-body--full': styleOptions.fullWidthMedia }"
            v-html="magazineHtml"
          />
          <p v-else class="ppv__empty">正文还是空的。</p>
        </article>
      </template>

      <!-- ===== 方案 D：分节卡片 ===== -->
      <template v-else-if="postStyle === 'cards'">
        <div v-if="styleOptions.miniNav" class="pg-mini">
          <div class="pg-mini__inner">
            <span class="pg-mini__title">{{ props.title || '未命名文章' }}</span>
            <nav v-if="cardHeadings.length" class="pg-mini__chips">
              <a v-for="h in cardHeadings" :key="h.id" class="pg-chip" :href="`#${h.id}`">{{ h.text }}</a>
            </nav>
          </div>
          <div class="pg-mini__prog"><i :style="{ width: `${PREVIEW_PROGRESS}%` }" /></div>
        </div>

        <article class="pg-stack">
          <section class="pg-card pg-card--head">
            <div class="pg-chips">
              <span class="pg-pill pg-pill--dark">{{ pageLabel }}</span>
            </div>
            <h1 class="pg-title pg-title--d">{{ props.title || '未命名文章' }}</h1>
            <p v-if="lede" class="pg-lede pg-lede--d">{{ lede }}</p>
            <div class="pg-meta pg-meta--head">
              <span class="pg-meta__date">{{ formatDate(props.date) }}</span>
              <span>Garfield God</span>
              <span>约 {{ readMinutes }} 分钟</span>
              <span>阅读 0 次</span>
            </div>
          </section>

          <section v-if="!contentHtml" class="pg-card">
            <p class="ppv__empty">正文还是空的。</p>
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
        <!-- 配了合法地址：摆出中转页的样子。预览是静态的，倒计时直接显示设定的秒数 -->
        <div v-if="linkTarget" class="pg-card pg-link">
          <span class="pg-link__badge">即将离开本站</span>
          <h1 class="pg-link__title">{{ props.title || '未命名文章' }}</h1>

          <!-- 与前台一致：正文紧跟标题下方，没写正文时才退回摘要 -->
          <div v-if="contentHtml" class="pg-link__note gg-content" v-html="prepared.html" />
          <p v-else-if="lede" class="pg-link__lede">{{ lede }}</p>

          <hr class="pg-rule" />

          <p class="pg-link__status">正在跳转到 <b>{{ linkTarget.host }}</b>…</p>

          <span class="pg-link__btn">立即前往 <span aria-hidden="true">↗</span></span>

          <p class="pg-link__url">{{ linkTarget.url }}</p>

          <p v-if="linkTarget.delay > 0" class="pg-link__timer">
            <span aria-hidden="true">{{ linkTarget.delay }} 秒后自动跳转</span>
            ·
            <span class="pg-link__stay">留在此页</span>
          </p>
        </div>

        <!-- 没填地址 / 协议不合法：前台会静默回落成单栏正文，这里提示作者补上 -->
        <div v-else class="pg-card pg-link__plain">
          <p class="ppv__warn">还没填写合法的跳转地址，前台会按普通文章显示这一篇。</p>
          <h1 class="pg-link__title">{{ props.title || '未命名文章' }}</h1>

          <hr class="pg-rule" />

          <div v-if="contentHtml" class="pg-body pg-body--a gg-content" v-html="prepared.html" />
          <p v-else class="ppv__empty">正文还是空的。</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 正文宽度挡位：默认沿用模板的 650px。
   --post-w 供四种方案复用（与前台同名变量），--ppv-w 供默认卡片使用。 */
.ppv { --ppv-w: 650px; --post-w: 650px; background: var(--gg-bg); }
.ppv.is-wide { --ppv-w: 1000px; --post-w: 1000px; }
.ppv.is-normal { --ppv-w: 800px; --post-w: 800px; }
.ppv.is-narrow { --ppv-w: 460px; --post-w: 460px; }
/* 画布固定成「宽屏下的页面宽度」，卡片宽度不随挡位变化，
   四种挡位才能在同一张画布上比出正文的宽窄。
   zoom 默认值仅作首帧 / SSR 兜底，挂载后由 usePreviewFit 按面板实际宽度改写。
   画布的内边距即前台的页面留白，方案自身不再承担左右留白。 */
.ppv__stage {
  position: relative;
  width: 1080px;
  zoom: var(--ppv-zoom, 0.37);
  padding: 24px 40px 32px;
  background: var(--gg-bg);
}

/* 复刻前台单篇文章卡片：白底圆角、衬线大标题居中、正文 650px 居中 */
.ppv__card {
  position: relative;
  background: #ffffff;
  border-radius: 15px;
  padding: 22px 40px;
  color: #000000;
  font-size: 1.125rem;
  line-height: 1.6;
}
.ppv__draft {
  position: absolute;
  top: 20px;
  left: 24px;
  z-index: 5;
  padding: 3px 12px;
  border-radius: 999px;
  background: #fff6e5;
  border: 1px solid #f0d9a8;
  color: #8a5a00;
  font-size: 0.85rem;
}
.ppv__title {
  font-family: var(--gg-serif);
  font-size: 3rem;
  font-weight: 300;
  line-height: 1.15;
  text-align: center;
  color: #000000;
  margin: 0 0 60px;
}
.ppv__sep {
  border: none;
  border-bottom: 2px solid #808080;
  opacity: 0.4;
  margin: 0 auto;
}
.ppv__content { max-width: var(--ppv-w); margin: 1.5rem auto 0; }

/* 同前台文章页：全局 .gg-content > * 的 720px 会把宽幅 / 正常挡位截短，
   这里用更高优先级把块宽交还给 --ppv-w，四种挡位才与实际页面一致。 */
.ppv__content.gg-content > * {
  max-width: 100%;
}
.ppv__content :deep(p),
.ppv__content :deep(ul),
.ppv__content :deep(ol),
.ppv__content :deep(figure),
.ppv__content :deep(blockquote) {
  margin: 1.5rem 0 0;
}
.ppv__content :deep(h1),
.ppv__content :deep(h2) {
  font-family: var(--gg-serif);
  font-size: 2.6rem;
  font-weight: 300;
  line-height: 1.2;
  margin: 1.5rem 0 0;
}
.ppv__content :deep(h3) {
  font-family: var(--gg-serif);
  font-size: 2.1rem;
  font-weight: 300;
  line-height: 1.15;
  margin: 1.5rem 0 0;
}
.ppv__content :deep(h4) {
  font-family: var(--gg-serif);
  font-weight: 300;
  line-height: 1.15;
  margin: 1.5rem 0 0;
}
.ppv__content :deep(img) { max-width: 100%; height: auto; }

/* 正文末尾留白：真站是 300px，缩略预览收窄一些 */
.ppv__spacer { height: 160px; margin-top: 1.5rem; }

.ppv__empty { max-width: var(--ppv-w); margin: 1.5rem auto 0; color: #6d6d6d; }

.ppv__meta {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 24px;
  max-width: var(--ppv-w);
  margin: 1.5rem auto 0;
  font-size: 1rem;
}
.ppv__date { font-style: italic; font-weight: 400; }
.ppv__pages a { color: #000000; }
.ppv__views { color: #6d6d6d; }

/* ===================================================================
   以下为四种可选方案，与 pages/post/[id].vue 保持同一套类名与观感。
   差异只有三处，都是「缩略预览」本身的性质决定的：
   1. 画布固定 1080px，故把 clamp(…vw…) 收敛为桌面端的峰值尺寸；
   2. 画布由 --ppv-zoom 缩放，sticky / fixed 在缩放层内会失真，
      目录栏与迷你导航改为静态、顶部进度条改为画布内的绝对定位；
   3. 不挂滚动监听，进度条统一停在 PREVIEW_PROGRESS 处展示形态。
   =================================================================== */

/* 画布留白：默认 / A / B 用画布自身的内边距；
   杂志大图与分节卡片是「出血」版式，画布左右不留白，交给内部容器 */
.ppv__stage.post-style-magazine,
.ppv__stage.post-style-cards {
  padding: 0 0 32px;
}

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
  margin: 44px auto;
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
.pg-meta__pages { color: #000000; }
.pg-meta__views { color: var(--gg-muted); }

/* ---------- 方案 A：经典单栏精修 ---------- */
/* 统一用 .ppv__stage.方案根类 限定，避免 .pg-card / .pg-title 这类
   公共类名串到 B / D 的方案里（B、D 的卡片另有 padding 与标题对齐） */
.ppv__stage.post-style-classic .pg-card {
  background: #ffffff;
  border-radius: 15px;
  padding: 56px 72px;
  color: #000000;
  font-size: 1.0625rem;
  line-height: 1.85;
}
/* 前台是 fixed 的页面级进度条；画布内改成画布顶部的绝对定位 */
.ppv__stage.post-style-classic .pg-progress {
  position: absolute;
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
  transform-origin: 0 50%;
}
.ppv__stage.post-style-classic .pg-title {
  font-size: 2.9rem;
  line-height: 1.18;
  text-align: center;
  margin: 0 0 14px;
}
.ppv__stage.post-style-classic .pg-lede {
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
.ppv__stage.post-style-classic .pg-meta {
  justify-content: flex-end;
  max-width: var(--post-w);
  margin: 56px auto 0;
}

/* ---------- 方案 E：超链接（中转页） ---------- */
/* 与前台同一套外观；预览里没有真实跳转，倒计时显示的是设定的秒数 */
.ppv__stage.post-style-link .pg-link,
.ppv__stage.post-style-link .pg-link__plain {
  max-width: 880px;
  margin: 0 auto;
  padding: 60px 52px;
  color: #000000;
}
/* 预览是固定宽度的画布，clamp/vh 在这里没有意义，直接取桌面端的样子 */
.ppv__stage.post-style-link .pg-link {
  min-height: 500px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: center;
  text-align: center;
}
.ppv__stage.post-style-link .pg-link__plain { text-align: left; }
.ppv__stage.post-style-link .pg-link__badge {
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
.ppv__stage.post-style-link .pg-link__title {
  font-family: var(--gg-serif);
  font-weight: 300;
  font-size: 2.5rem;
  line-height: 1.25;
  margin: 20px 0 0;
}
.ppv__stage.post-style-link .pg-link__plain .pg-link__title { margin: 0; }
.ppv__stage.post-style-link .pg-link__lede {
  max-width: 34em;
  margin: 14px auto 0;
  color: #4a4a4a;
  font-size: 1.02rem;
  line-height: 1.75;
}
.ppv__stage.post-style-link .pg-link__status {
  margin: 0;
  font-size: 1.05rem;
  color: #3b3b3b;
}
.ppv__stage.post-style-link .pg-link__btn {
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
}
.ppv__stage.post-style-link .pg-link__url {
  margin: 14px 0 0;
  font-size: 0.82rem;
  color: #6d6d6d;
  /* 长地址不许把卡片撑宽 */
  overflow-wrap: anywhere;
}
.ppv__stage.post-style-link .pg-link__timer {
  margin: 12px 0 0;
  font-size: 0.88rem;
  color: #6d6d6d;
}
.ppv__stage.post-style-link .pg-link__stay { text-decoration: underline; text-underline-offset: 3px; }
/* 正文紧跟标题，不再是「贴底的一段」 */
.ppv__stage.post-style-link .pg-link__note {
  max-width: var(--post-w);
  margin: 22px auto 0;
}
.ppv__stage.post-style-link .pg-link__note :deep(p) { text-align: left; }

/* 作者提示：只在预览里出现，前台回落时不显示 */
.ppv__warn {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #f0f0f0;
  color: #3b3b3b;
  font-size: 0.92rem;
}

/* ---------- 方案 B：左文右栏（目录 / 阅读进度） ---------- */
.pg-wrap {
  max-width: 1100px;
  margin: 0 auto;
}
.ppv__stage .pg-card--toc {
  background: #ffffff;
  border-radius: 15px;
  padding: 52px 48px;
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
.ppv__stage .pg-title--b {
  font-size: 2.4rem;
  font-weight: 400;
  line-height: 1.22;
  margin: 0 0 12px;
}
.ppv__stage .pg-lede--b {
  max-width: 46em;
  font-size: 1rem;
}
.ppv__stage .pg-rule--b {
  opacity: 0.28;
  margin: 36px 0 0;
}
.pg-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 236px;
  gap: 56px;
  align-items: start;
  margin-top: 36px;
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
/* 前台 sticky 跟随阅读；画布内静态摆放 */
.ppv__stage .pg-rail {
  position: static;
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
.pg-toc { display: grid; gap: 1px; }
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
  background: #000000;
}
.pg-prog__num {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--gg-muted);
  font-variant-numeric: tabular-nums;
}
.pg-rail__pages { margin: 0; display: grid; gap: 6px; }
.pg-rail__link { font-size: 0.86rem; color: #000000; }

/* ---------- 方案 C：杂志大图 ---------- */
.ppv__stage .pg-hero {
  position: relative;
  height: 400px;
  overflow: hidden;
  background: #000000;
}
.ppv__stage .pg-hero--compact { height: 260px; }
.ppv__stage .pg-hero--tall { height: 540px; }
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
  font-size: 3.1rem;
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
  padding: 0 48px 44px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.1);
}
/* 挡位 none：没有封面带，标题区落到白卡顶端，白卡也不再上浮重叠 */
.pg-sheet--nocover { margin-top: 32px; padding-top: 44px; }
.pg-nocover__chip {
  display: inline-block;
  font-size: 0.74rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--gg-ink);
  border: 1px solid rgba(0, 0, 0, 0.3);
  border-radius: 999px;
  padding: 4px 12px;
  margin-bottom: 16px;
}
.pg-nocover__title {
  font-family: var(--gg-serif);
  font-size: 3.1rem;
  font-weight: 400;
  line-height: 1.16;
  margin: 0 0 12px;
  max-width: 20em;
}
.pg-nocover__lede {
  font-size: 1.06rem;
  line-height: 1.7;
  color: var(--gg-inksoft);
  margin: 0;
  max-width: 40em;
}
/* 居中标题：整块一起居中，且只到标题块，不落到署名与正文上 */
.pg-hero.is-center .pg-hero__inner {
  align-items: center;
  text-align: center;
}
.pg-hero.is-center .pg-hero__chip {
  align-self: center;
}
.pg-sheet.is-center .pg-nocover-head {
  text-align: center;
}
.pg-sheet.is-center .pg-nocover__title,
.pg-sheet.is-center .pg-nocover__lede {
  margin-left: auto;
  margin-right: auto;
}
/* 图片撑满内容区（可选）：只解除页面的 720px 上限，不覆盖内容 HTML 的 width 声明。
   比例由全局 img { height: auto } 保证 */
.pg-body--full :deep(> figure),
.pg-body--full :deep(> p:has(img)) {
  max-width: 100%;
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
  font-size: 1.7rem;
  line-height: 1.55;
}
.pg-body--c :deep(pre) { padding: 18px 20px; }

/* ---------- 方案 D：分节卡片 ---------- */
/* 前台 sticky 吸顶；画布内静态摆放 */
.ppv__stage .pg-mini {
  position: static;
  background: rgba(246, 246, 246, 0.93);
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
}
.pg-mini__prog { height: 2px; background: transparent; }
.pg-mini__prog i {
  display: block;
  height: 100%;
  background: #000000;
}
.pg-stack {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  display: grid;
  gap: 18px;
}
.pg-stack .pg-card {
  background: #ffffff;
  border-radius: 15px;
  padding: 26px 34px;
}
.pg-stack .pg-card--head { padding: 34px 34px 30px; }
.pg-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.pg-pill {
  font-size: 0.76rem;
  color: var(--gg-inksoft);
  background: var(--gg-surface-2);
  border-radius: 999px;
  padding: 3px 11px;
}
.pg-pill--dark { background: #000000; color: #ffffff; }
.ppv__stage .pg-title--d {
  font-size: 2.25rem;
  font-weight: 400;
  line-height: 1.2;
  margin: 0 0 12px;
}
.ppv__stage .pg-lede--d {
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

/* 方案内的「正文还是空的」提示不要带默认卡片的居中留白 */
.pg-body .ppv__empty,
.pg-sec__body .ppv__empty,
.pg-sheet .ppv__empty { max-width: 100%; margin: 1.4rem 0 0; }
</style>

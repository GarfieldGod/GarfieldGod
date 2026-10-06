<script setup lang="ts">
import { usePostDetail, tabName } from '~/composables/useSiteData'

const route = useRoute()
const id = String(route.params.id)

// 与分类页（pages/[...path].vue）同一套：
// 服务端等数据齐才输出完整 HTML（SEO 与 404 判定）；客户端导航不等接口、立刻切页，
// 先渲染骨架屏，数据到了再挂载 PostView。
//
// 正文、阅读数、留言原本是三个串行 await，各自经 Cloudflare 回源要 1–5 秒，
// 叠起来就是「从列表点进文章要等很久」的原因。现在三个请求分居两处、都不再阻塞切页。
//
// 水合期 sessionCachedData 直接读 payload 里服务端那一份，所以首帧渲染的就是完整正文，
// 与 SSR 输出一致，不会水合不匹配。
//
// 模板根元素必须固定为下面这一个 div：页面过渡是 out-in 模式，若根节点在过渡期间
// 从骨架 div 换成 PostView（组件），Vue 会拿不到 leave 回调而抛
// 「Cannot read properties of null (reading 'Symbol(_leaveCb)')」，整页白屏。
// 所以外壳始终是同一个 div，只在它内部切换骨架 / 正文（与 [...path].vue 同款写法）。
const res = usePostDetail(id)
if (import.meta.server) await res
const { data, error } = res

if (import.meta.server && (error.value || !data.value?.post)) {
  throw createError({ statusCode: 404, message: '文章不存在', fatal: true })
}
// 客户端导航时数据后到：确实不存在再落到错误页
watch(error, (e) => {
  if (e) showError(createError({ statusCode: 404, message: '文章不存在', fatal: true }))
})

const post = computed(() => data.value?.post)

// 进文章页请求播放它的背景音乐：先试一次自动播放，被浏览器拦下时由右下角播放器
// 展开气泡询问。放在挂载之后触发（而不是 setup 期），避免在水合阶段改动播放器状态
// 造成水合不匹配；客户端切到另一篇文章时由 watch 兜住。
const player = useAudioPlayer()
function requestPostBgm() {
  const p = post.value
  if (p) player.requestBgm(`post:${p.id}`, p.bgmSrc ?? '')
}
watch(post, requestPostBgm)
onMounted(requestPostBgm)

// 标签页标题：文章名 — 站名（站名独立于导航栏「名称」，来自「站点信息」，后台可改）。
// site-meta 由 layout 取过，这里命中缓存，不会多一次往返。
const { data: meta } = await useSiteMeta()
useHead({
  title: () => (post.value ? `${post.value.title} — ${tabName(meta.value)}` : tabName(meta.value)),
})
</script>

<template>
  <div class="post-shell">
    <PostView v-if="post" :post="post" />
    <div v-else class="post-skeleton" aria-busy="true" aria-label="文章加载中">
      <div class="post-skeleton__card">
        <div class="post-skeleton__title" />
        <hr class="post-skeleton__sep" />
        <div
          v-for="i in 7"
          :key="i"
          class="post-skeleton__line"
          :class="{ 'is-short': i % 3 === 0 }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 骨架屏沿用「默认」方案的卡片外观：切页时先占住版面，正文到位后不会跳版 */
.post-skeleton {
  padding: 1.5rem max(1.25rem, 5vw) 0;
}
.post-skeleton__card {
  background: #ffffff;
  border-radius: 15px;
  padding: 22.5px max(1.25rem, 5vw);
}
.post-skeleton__title {
  height: clamp(2.75rem, 6vw, 3.25rem);
  max-width: 620px;
  margin: 0 auto clamp(2rem, 8vw, 96px);
  border-radius: 10px;
}
.post-skeleton__sep {
  border: none;
  border-bottom: 2px solid #808080;
  opacity: 0.4;
  max-width: 1000px;
  margin: 0 auto;
}
.post-skeleton__line {
  height: 1.1rem;
  max-width: 650px;
  margin: 1.5rem auto 0;
  border-radius: 6px;
}
.post-skeleton__line.is-short {
  max-width: 420px;
}
.post-skeleton__title,
.post-skeleton__line {
  background: linear-gradient(90deg, #ececec 25%, #f6f6f6 37%, #ececec 63%);
  background-size: 400% 100%;
  animation: post-skeleton-shimmer 1.4s ease infinite;
}
@keyframes post-skeleton-shimmer {
  from {
    background-position: 100% 50%;
  }
  to {
    background-position: 0 50%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .post-skeleton__title,
  .post-skeleton__line {
    animation: none;
  }
}
</style>
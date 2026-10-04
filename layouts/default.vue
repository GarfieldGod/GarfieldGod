<script setup lang="ts">
import { useSiteMeta, useNavPages, navPagePath } from '~/composables/useSiteData'
import type { NavPage } from '~/composables/useSiteData'
import { coverSrc } from '~/utils/pageFormat'

const { data: meta } = await useSiteMeta()
const { data: navData } = await useNavPages()
const route = useRoute()
const menuOpen = ref(false)
const openDir = ref<number | null>(null)

// 头像与站点地址都来自「站点信息」，未设置时回落到原站资源
const DEFAULT_AVATAR = '/media/609-1686745579-2-s.jpg'
const DEFAULT_FAVICON = '/uploads/library/59-cropped-1-2.jpg'
const DEFAULT_HOME_COVER = '/uploads/library/605-1686742077-1.jpg'
const avatarSrc = computed(() => meta.value.avatar || DEFAULT_AVATAR)
const faviconSrc = computed(() => meta.value.favicon || DEFAULT_FAVICON)

// 与 nuxt.config 的默认图标共用 key，后台设置图标后覆盖默认值
useHead({ link: [{ rel: 'icon', key: 'favicon', href: faviconSrc }] })

const siteHost = computed(() => {
  const raw = meta.value.url?.trim()
  if (!raw) return 'garfieldgod.cn'
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).host
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  }
})

// 导航结构与页面形态都读 nav_pages：顶层项 + 子菜单项
const pages = computed(() => navData.value.pages)
const visible = (p: NavPage) => p.navVisible
const topLevel = computed(() => pages.value.filter((p) => p.parentId === 0 && visible(p)))
const childrenOf = (id: number) => pages.value.filter((p) => p.parentId === id && visible(p))

const isHome = computed(() => route.path === '/')
const currentPage = computed(() => pages.value.find((p) => navPagePath(p) === route.path) ?? null)

// 关于页（slug 为保留页 personal）：访客统计模块挂在它的正文下方、页脚上方
const ABOUT_SLUG = 'personal'
const isAbout = computed(() => currentPage.value?.slug === ABOUT_SLUG)

// 访客上报：layout 在 SPA 内不随路由切换重建，所以整页加载各上报一次。
// 静默吞掉失败——统计属于附带功能，不能影响页面可用性。
onMounted(async () => {
  try {
    await $fetch('/api/visits', { method: 'POST' })
    // 落在关于页时，SSR 的取数发生在上报之前，刷新一次让「今天」也包含本次访问
    if (isAbout.value) await refreshNuxtData('visit-stats')
  } catch {
    // 忽略：上报或刷新失败都不该影响页面
  }
})
// 封面是否展开由页面配置决定（当前只有首页为 true）
const showCover = computed(() => currentPage.value?.showCover ?? false)
// 页面封面同样要归一化：老数据是裸文件名，新上传是 /uploads/... 完整路径
const coverImageSrc = computed(
  () => coverSrc(currentPage.value?.coverImage) || DEFAULT_HOME_COVER,
)

const socials = [
  { label: 'GitHub', href: 'https://github.com/GarfieldGod', img: '/media/github.svg' },
  { label: 'Steam', href: 'https://steamcommunity.com/profiles/76561198239055708', img: '/media/steam-icon.png' },
  { label: 'Bilibili', href: 'https://space.bilibili.com/12008567', img: '/media/bilibili-icon.png' },
]
</script>

<template>
  <div class="site">
    <!-- 封面图：常驻 DOM，靠 is-collapsed 收起/展开，保证首页↔其他页可平滑过渡 -->
    <section class="site-cover" :class="{ 'is-collapsed': !showCover }">
      <img class="site-cover__bg" :src="coverImageSrc" alt="" aria-hidden="true" :fetchpriority="isHome ? 'high' : 'low'" />
      <div class="site-cover__scrim" />
    </section>

    <!-- 主导航：复刻原站深色导航栏（头像+站名 居左，菜单 居右） -->
    <header class="site-header" :class="{ 'site-header--home': isHome }">
      <div class="site-header__inner">
        <div class="site-header__brand">
          <NuxtLink to="/" class="site-header__avatar" aria-label="回到首页">
            <img :src="avatarSrc" alt="GarfieldGod 头像" width="132" height="132" />
          </NuxtLink>
          <div class="site-header__identity">
            <h1 class="site-header__title">{{ meta.title }}</h1>
            <p class="site-header__tagline">{{ meta.tagline }}</p>
            <p class="site-header__domain"><em><a href="/">{{ siteHost }}</a></em></p>
          </div>
        </div>

        <button class="nav-toggle" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
          <span class="nav-toggle__bar" />
          <span class="nav-toggle__bar" />
          <span class="nav-toggle__bar" />
        </button>

        <nav class="site-nav" :class="{ 'is-open': menuOpen }">
          <template v-for="item in topLevel" :key="item.id">
            <!-- 有子页面：父项本身可跳转到自己的页面，箭头单独负责展开下拉 -->
            <div
              v-if="childrenOf(item.id).length"
              class="site-nav__dir"
              @mouseenter="openDir = item.id"
              @mouseleave="openDir = null"
            >
              <NuxtLink
                :to="navPagePath(item)"
                class="site-nav__link site-nav__link--parent"
                :class="{ 'is-active': route.path === navPagePath(item) }"
                @click="openDir = null"
              >
                {{ item.title }}
              </NuxtLink>
              <button
                type="button"
                class="site-nav__caret-btn"
                :aria-expanded="openDir === item.id"
                :aria-label="`展开「${item.title}」子菜单`"
                @click="openDir = openDir === item.id ? null : item.id"
              >
                <svg class="site-nav__caret" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M1.5 4l4.5 4 4.5-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <div class="site-nav__submenu" :class="{ 'is-open': openDir === item.id }">
                <NuxtLink
                  v-for="c in childrenOf(item.id)"
                  :key="c.id"
                  :to="navPagePath(c)"
                  class="site-nav__subitem"
                  @click="openDir = null"
                >
                  {{ c.title }}
                </NuxtLink>
              </div>
            </div>

            <NuxtLink
              v-else
              :to="navPagePath(item)"
              class="site-nav__link"
              :class="{ 'is-active': route.path === navPagePath(item) }"
            >
              {{ item.title }}
            </NuxtLink>
          </template>
        </nav>
      </div>
    </header>

    <main class="site-main" @click="menuOpen = false; openDir = null">
      <slot />
    </main>

    <!-- 访客统计：仅关于页显示，落在正文之下、页脚之上 -->
    <VisitStats v-if="isAbout" />

    <footer class="site-footer" :class="{ 'site-footer--after-visits': isAbout }">
      <hr class="site-footer__sep" />
      <div class="site-footer__inner">
        <div class="site-footer__socials">
          <a v-for="s in socials" :key="s.label" :href="s.href" target="_blank" rel="noopener" class="social-link" :aria-label="s.label">
            <img :src="s.img" :alt="s.label" class="social-img" width="26" height="26" />
            {{ s.label }}
          </a>
        </div>
        <a class="site-footer__icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">
          工信部备案号：蜀ICP备2023012083号-1
        </a>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ===== 封面（全宽，复刻原站 Gutenberg cover：430px 高，object-position 50% 70%）===== */
.site-cover {
  position: relative;
  width: 100%;
  height: 430px;
  overflow: hidden;
  /* 底色与导航栏一致：图片淡出后露出黑色，收缩过程不会出现突兀的浅色带 */
  background: #000000;
  /* 首页↔其他页：仅高度收缩，与导航栏用同一条曲线保证同步 */
  transition: height 0.42s cubic-bezier(0.4, 0, 0.2, 1);
}
.site-cover.is-collapsed {
  height: 0;
  pointer-events: none;
}
.site-cover__bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 70%;
  transition: opacity 0.3s ease;
}
/* 原站 has-background-dim：黑色 50% 遮罩（保留色彩，仅压暗） */
.site-cover__scrim {
  position: absolute;
  inset: 0;
  background: #000;
  opacity: 0.5;
  transition: opacity 0.3s ease;
}
/* 收起时只让图片与遮罩淡出，封面黑色底随高度归零自然消失 */
.site-cover.is-collapsed .site-cover__bg,
.site-cover.is-collapsed .site-cover__scrim {
  opacity: 0;
}

/* ===== 主导航栏（纯黑，复刻原站 foreground-background #000000）===== */
.site-header {
  background: #000000; /* 原站 --wp--preset--color--foreground: #000000 */
  color: #ececec;
  border-bottom: 1px solid #1e1e1e;
  position: relative;
  z-index: 50;
  /* 非首页：导航栏稍矮 */
  --gg-header-pad: 18px;
  --gg-avatar: 132px;
}
/* 首页：导航栏更高、头像更大（仅首页生效，不影响其他页面） */
.site-header--home {
  --gg-header-pad: 28px;
  --gg-avatar: 150px; /* 原站头像 width/height 150 */
}
.site-header__inner {
  max-width: var(--gg-max);
  margin: 0 auto;
  padding: var(--gg-header-pad) 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  /* 首页↔其他页：内边距随之收缩，与封面同步 */
  transition: padding 0.42s cubic-bezier(0.4, 0, 0.2, 1);
}
.site-header__brand { display: flex; align-items: center; gap: 20px; }
.site-header__avatar img {
  width: var(--gg-avatar);
  height: var(--gg-avatar);
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  object-fit: cover;
  display: block;
  transition: width 0.42s cubic-bezier(0.4, 0, 0.2, 1), height 0.42s cubic-bezier(0.4, 0, 0.2, 1);
}
.site-header__identity { line-height: 1.3; }
/* 原站标题为 h2：Source Serif Pro 衬线（艺术字），gigantic 字号，weight 700，纯白 */
.site-header__title {
  font-family: var(--gg-serif);
  font-size: clamp(2.75rem, 6vw, 3.25rem);
  font-weight: 700;
  line-height: 1.1;
  margin: 0;
  color: #ffffff;
}
.site-header__tagline { margin: 4px 0 0; font-size: 1.125rem; color: #ffffff; }
.site-header__domain { margin: 3px 0 0; font-size: 1rem; color: #ffffff; }
.site-header__domain a { color: #ffffff; }

/* 导航：纯文字项，无背景盒（复刻原站）；项间距按原站实测约 1rem */
.site-nav { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.site-nav__link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 0;
  font-size: 1.5rem;
  font-weight: 400;
  color: #ffffff;
  text-decoration: none;
  cursor: pointer;
  transition: opacity 0.15s;
}
.site-nav__link:hover {
  color: #ffffff;
  opacity: 0.8;
  text-decoration: underline;
  text-underline-offset: 8px;
  text-decoration-thickness: 1.5px;
}
.site-nav__link.is-active { color: #ffffff; }
.site-nav__link--parent {
  background: transparent;
  border: none;
  font: inherit;
  color: #ffffff;
  font-size: 1.5rem;
  font-weight: 400;
  padding: 6px 0;
  display: inline-flex;
  align-items: center;
}
.site-nav__dir:hover .site-nav__link--parent {
  color: #ffffff;
  opacity: 0.8;
  text-decoration: underline;
  text-underline-offset: 8px;
  text-decoration-thickness: 1.5px;
}
.site-nav__caret { transition: transform 0.2s; }
.site-nav__dir { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.site-nav__dir:hover .site-nav__caret { transform: rotate(180deg); }
/* 展开箭头独立成按钮：父项文字负责跳转，箭头负责展开子菜单（触屏/键盘可用） */
.site-nav__caret-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  color: #ffffff;
  cursor: pointer;
  transition: opacity 0.15s;
}
.site-nav__dir:hover .site-nav__caret-btn { opacity: 0.8; }
.site-nav__submenu {
  position: absolute;
  top: 100%;
  /* 右对齐父项：向左展开，避免浮窗越过内容右边界撑出横向滚动条 */
  left: auto;
  right: 0;
  min-width: 170px;
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  padding: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
/* 顶部透明桥接区：让鼠标从父项移入子菜单时无间断 */
.site-nav__submenu::before {
  content: "";
  position: absolute;
  top: -12px;
  left: 0;
  right: 0;
  height: 12px;
}
.site-nav__dir:hover .site-nav__submenu,
.site-nav__submenu.is-open { opacity: 1; pointer-events: auto; }
.site-nav__subitem {
  display: block;
  padding: 8px 12px;
  border-radius: 8px;
  color: #dcdcdc;
  text-decoration: none;
  font-size: 1rem;
}
.site-nav__subitem:hover { color: #fff; text-decoration: underline; text-underline-offset: 4px; }

.nav-toggle {
  display: none;
  flex-direction: column;
  gap: 5px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
}
.nav-toggle__bar { width: 22px; height: 2px; background: #fff; border-radius: 2px; }

.site-main { min-height: 60vh; }

/* ===== 页脚（复刻原站：浅灰背景 + 全宽分割线，无深色底）===== */
.site-footer { margin-top: clamp(4rem, 10vw, 8rem); }
/* 关于页上方已有访客模块，页脚顶部间距收窄，避免两段留白叠加 */
.site-footer--after-visits { margin-top: clamp(2rem, 4vw, 3rem); }
/* 分割线：对应原站 alignfull 的 wp-block-separator，2px 实线、opacity .4 */
.site-footer__sep { border: none; border-bottom: 2px solid #808080; opacity: 0.4; margin: 0; }
.site-footer__inner {
  max-width: var(--gg-max);
  margin: 0 auto;
  padding: 64px 24px;
  text-align: center;
  display: grid;
  gap: 24px;
  justify-items: center;
}
.site-footer__socials { display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; align-items: center; }
.social-link { display: inline-flex; align-items: center; gap: 8px; color: var(--gg-ink); text-decoration: none; font-size: 0.92rem; opacity: 0.85; }
.social-link:hover { opacity: 1; }
.social-img { width: 26px; height: 26px; border-radius: 6px; object-fit: contain; filter: grayscale(1); opacity: 0.85; transition: filter 0.2s, opacity 0.2s; }
.social-link:hover .social-img { filter: grayscale(0); opacity: 1; }
.site-footer__icp { color: var(--gg-muted); text-decoration: none; font-size: 0.85rem; }
.site-footer__icp:hover { color: var(--gg-ink); }

/* 断点 980px：导航恢复为原站 5 项后整行更宽，低于此宽度「头像+站名」与导航同排会放不下，提前切换为汉堡菜单 */
@media (max-width: 980px) {
  .site-header__avatar img { width: 72px; height: 72px; }
  .site-header__title { font-size: 1.4rem; }
  .site-header__tagline { font-size: 0.95rem; }
  .nav-toggle { display: flex; }
  .site-nav {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    flex-direction: column;
    align-items: stretch;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
    padding: 8px 14px 16px;
    gap: 4px;
    display: none;
  }
  .site-nav.is-open { display: flex; }
  .site-nav__link,
  .site-nav__link--parent { font-size: 1.2rem; padding: 8px 4px; }
  /* 移动端子菜单常显，展开箭头不再需要 */
  .site-nav__dir { display: block; }
  .site-nav__caret-btn { display: none; }
  .site-nav__submenu { position: static; opacity: 1; pointer-events: auto; box-shadow: none; border: none; padding-left: 16px; }
  .site-nav__submenu::before { display: none; }
  .site-header__inner { padding: 16px 18px; }
  .site-cover { height: 240px; }
}

/* 偏好减少动效：封面/导航直接瞬时切换 */
@media (prefers-reduced-motion: reduce) {
  .site-cover,
  .site-cover__bg,
  .site-cover__scrim,
  .site-header__inner,
  .site-header__avatar img { transition: none; }
}
</style>
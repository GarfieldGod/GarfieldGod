<script setup lang="ts">
// 访客统计模块：累计访客大数字 + 近 7 天柱状图。
// 纯 CSS 画柱状图，不引图表库；数据由公开接口 /api/visits 提供（服务端已渲染好，无闪烁）。
interface VisitDay {
  day: string
  count: number
}

interface VisitStats {
  total: number
  days: VisitDay[]
  today: string
}

const { data, error } = await useFetch<VisitStats>('/api/visits', { key: 'visit-stats' })

// 取数失败时组件不渲染（访客不该看到报错），但要留痕以便排查
if (error.value) console.error('[visits] 读取访客统计失败：', error.value)

const days = computed(() => data.value?.days ?? [])

// 按当期最大值等比缩放；全部为 0 时用 1 兜底，避免除零
const maxCount = computed(() => Math.max(1, ...days.value.map((d) => d.count)))

function barHeight(count: number): string {
  // 最小 3px：当天 0 人也留一个小点，柱子不会整列消失
  return `${Math.max(3, Math.round((count / maxCount.value) * 96))}px`
}

function dateLabel(day: string): string {
  if (day === data.value?.today) return '今天'
  const [, month, date] = day.split('-')
  return `${Number(month)}/${Number(date)}`
}
</script>

<template>
  <section v-if="data" class="visits">
    <div class="visits__card">
      <div class="visits__head">
        <span class="visits__total">{{ data.total }}</span>
        <span class="visits__label">历史累计访客</span>
      </div>

      <ol class="visits__chart" aria-label="近 7 天每日访客数">
        <li
          v-for="d in days"
          :key="d.day"
          class="visits__col"
          :class="{ 'is-today': d.day === data.today }"
          :aria-label="`${dateLabel(d.day)}：${d.count} 位访客`"
        >
          <span class="visits__value" aria-hidden="true">{{ d.count }}</span>
          <span class="visits__bar" :style="{ height: barHeight(d.count) }" aria-hidden="true" />
          <span class="visits__date" aria-hidden="true">{{ dateLabel(d.day) }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.visits {
  max-width: var(--gg-max);
  margin: clamp(3rem, 7vw, 5rem) auto 0;
  padding: 0 24px;
}
.visits__card {
  display: grid;
  gap: 18px;
  padding: 22px 26px 18px;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
}

/* 大数字与标签按基线对齐，避免字号差导致视觉错位 */
.visits__head { display: flex; align-items: baseline; gap: 10px; }
.visits__total {
  font-family: var(--gg-serif);
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  color: var(--gg-ink);
}
.visits__label { color: var(--gg-muted); font-size: 0.82rem; }

.visits__chart {
  display: flex;
  align-items: end;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 柱子区固定 96px 且贴底：各列柱子共享同一条基线，高度差才可比 */
.visits__col {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-rows: auto 96px auto;
  justify-items: center;
  align-items: end;
  gap: 6px;
}
.visits__value { font-size: 0.76rem; line-height: 1; color: var(--gg-muted); }
.visits__bar {
  width: 100%;
  max-width: 34px;
  border-radius: 5px 5px 0 0;
  background: #d0d0d0;
}
.visits__date { font-size: 0.72rem; line-height: 1; color: var(--gg-muted); white-space: nowrap; }

/* 今天：柱子转为主色，数值与日期一并加重 */
.visits__col.is-today .visits__bar { background: var(--gg-accent); }
.visits__col.is-today .visits__value { color: var(--gg-ink); font-weight: 700; }
.visits__col.is-today .visits__date { color: var(--gg-ink); font-weight: 600; }

@media (max-width: 560px) {
  .visits__card { padding: 18px 16px 14px; }
  .visits__chart { gap: 4px; }
  .visits__total { font-size: 26px; }
}
</style>
<script setup lang="ts">
import type { NavPageTag } from '~/composables/useSiteData'

const props = defineProps<{
  tags: NavPageTag[]
  active: string
  total: number
}>()

const emit = defineEmits<{ (e: 'select', tag: string): void }>()
</script>

<template>
  <aside v-if="props.tags.length" class="notes-filter" aria-label="分类筛选">
    <h2 class="notes-filter__title">分类</h2>
    <ul class="notes-filter__list">
      <li>
        <button class="notes-filter__item" :class="{ 'is-active': !props.active }" @click="emit('select', '')">
          <span class="notes-filter__name">全部</span>
          <span class="notes-filter__count">{{ props.total }}</span>
        </button>
      </li>
      <li v-for="tag in props.tags" :key="tag.name">
        <button
          class="notes-filter__item"
          :class="{ 'is-active': tag.name === props.active }"
          @click="emit('select', tag.name === props.active ? '' : tag.name)"
        >
          <span class="notes-filter__name">{{ tag.name }}</span>
          <span class="notes-filter__count">{{ tag.count }}</span>
        </button>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
/* 与文章条目同一套卡片样式：白底 + 浅灰描边 + 12px 圆角 */
.notes-filter {
  flex: none;
  width: 200px;
  position: sticky;
  top: 24px;
  align-self: flex-start;
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: var(--gg-radius);
  padding: 16px 14px;
}
.notes-filter__title {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--gg-muted);
  margin: 0 0 10px;
  padding-left: 12px;
}
.notes-filter__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.notes-filter__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.2;
  text-align: left;
  color: var(--gg-inksoft);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 9px 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.notes-filter__item:hover { background: var(--gg-accent-soft); color: var(--gg-ink); }
.notes-filter__item.is-active {
  /* 面板已是白色底，选中项用更深的灰拉开层次 */
  background: var(--gg-surface-2);
  border-color: var(--gg-border);
  color: var(--gg-ink);
  font-weight: 600;
}
.notes-filter__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notes-filter__count {
  flex: none;
  font-size: 0.78rem;
  color: var(--gg-muted);
  font-variant-numeric: tabular-nums;
}
.notes-filter__item.is-active .notes-filter__count { color: var(--gg-inksoft); }

/* 窄屏：左侧竖栏折叠为列表上方的横向标签行 */
@media (max-width: 860px) {
  .notes-filter { position: static; width: 100%; }
  .notes-filter__title { padding-left: 0; margin-bottom: 8px; }
  .notes-filter__list { display: flex; flex-wrap: wrap; gap: 8px; }
  .notes-filter__item { width: auto; padding: 7px 12px; border-color: var(--gg-border); }
}
</style>
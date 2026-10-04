<script setup lang="ts">
const props = defineProps<{
  current: number
  total: number
  variant?: 'inline' | 'bottom'
}>()

const emit = defineEmits<{ (e: 'go', page: number): void }>()
</script>

<template>
  <nav
    v-if="props.total > 1"
    class="pager"
    :class="props.variant === 'bottom' ? 'pager--bottom' : 'pager--inline'"
    aria-label="分页"
  >
    <button class="pager__btn" :disabled="props.current <= 1" @click="emit('go', props.current - 1)">上一页</button>
    <button
      v-for="n in props.total"
      :key="n"
      class="pager__num"
      :class="{ 'is-active': n === props.current }"
      :aria-current="n === props.current ? 'page' : undefined"
      @click="emit('go', n)"
    >
      {{ n }}
    </button>
    <button class="pager__btn" :disabled="props.current >= props.total" @click="emit('go', props.current + 1)">下一页</button>
  </nav>
</template>

<style scoped>
.pager { display: flex; align-items: center; gap: 6px; }
.pager--bottom { margin-top: 24px; justify-content: center; }
.pager__btn,
.pager__num {
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  color: var(--gg-inksoft);
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.pager__num { min-width: 34px; padding: 8px; text-align: center; }
.pager__btn:hover:not(:disabled),
.pager__num:hover:not(.is-active) { background: var(--gg-accent-soft); color: var(--gg-ink); }
.pager__num.is-active { background: var(--gg-ink); border-color: var(--gg-ink); color: #ffffff; cursor: default; }
.pager__btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
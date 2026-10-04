// /search 页配置的公开读取：该页是孤儿路由，不走站点布局，自己取这份数据渲染。
export default defineEventHandler(() => getSearchPage())
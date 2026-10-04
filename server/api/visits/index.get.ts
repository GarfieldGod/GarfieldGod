// 访客统计读取端：公开接口（关于页的访客模块对访客可见，不走后台鉴权）
export default defineEventHandler(() => visitStats())
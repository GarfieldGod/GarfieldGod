#!/usr/bin/env bash
# =============================================================================
# GarfieldGod 站点服务器一键更新脚本
#
# 用法（服务器上，任意目录执行，或用绝对路径调用）：
#   bash ~/GarfieldGod/update.sh
#   bash ~/GarfieldGod/update.sh <分支名>     # 不传默认 main
#
# 前置要求：
#   - ~/GarfieldGod 已 clone 自 GitHub 仓库并关联 origin（公开仓库，HTTPS 免密）
#   - 后端已注册为 systemd 服务 garfieldgod.service
#   - 已配置免密 sudo（/etc/sudoers.d/garfieldgod-deploy）以便重启服务
#
# 流程：
#   停服 -> 暂存服务器数据 -> 对齐仓库代码 -> 还原数据 -> 先起服保可用
#        -> 装依赖并构建 -> 重启服务切换新产物
#
# 数据策略：.data（SQLite 数据库 + 上传图片）以服务器为准。
#   更新前把 .data 整体移出工作区，代码对齐后再原样放回，
#   因此 git 既不会因数据库二进制改动而冲突，也不会覆盖线上数据。
#   注意：这意味着本地提交的数据改动不会同步到服务器。
# =============================================================================
set -euo pipefail

# npm ci 的 postinstall 会跑 nuxt prepare，Nuxt 首次运行会弹遥测问卷等输入，
# 无人值守的 SSH 部署会永远卡在这一步；禁用遥测保证构建全程非交互
export NUXT_TELEMETRY_DISABLED=1

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR"

SERVICE="garfieldgod"
BRANCH="${1:-main}"
DATA_DIR="$BASE_DIR/.data"
# 暂存目录放在仓库之外，避免被 git 看到；与仓库同盘，mv 为秒级原子操作
KEEP_ROOT="$(mktemp -d "${BASE_DIR}/../.gg-data-keep.XXXXXX")"

TOTAL=7
STAGE=0
say()  { printf "\n\033[1;36m[%s/%s] %s\033[0m\n" "$STAGE" "$TOTAL" "$1"; }
ok()   { printf "\033[1;32m   ok: %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m   !! %s\033[0m\n" "$1"; }
fail() { printf "\033[1;31m  ERR: %s\033[0m\n" "$1" >&2; exit 1; }

DATA_MOVED=0
restore_data() {
  # 任何退出路径（含报错、Ctrl+C）都要把线上数据放回去，避免数据停在临时目录
  if [ "$DATA_MOVED" = "1" ] && [ -d "$KEEP_ROOT/data" ]; then
    rm -rf "$DATA_DIR"
    mv "$KEEP_ROOT/data" "$DATA_DIR"
    DATA_MOVED=0
    printf "\033[1;33m   已还原服务器数据到 %s\033[0m\n" "$DATA_DIR"
  fi
  rmdir "$KEEP_ROOT" 2>/dev/null || true
}
trap restore_data EXIT INT TERM

# 服务是否存在（不用管道探测，避免 pipefail 下的 SIGPIPE 误判）
if systemctl cat "$SERVICE" >/dev/null 2>&1; then
  HAVE_SERVICE=1
else
  HAVE_SERVICE=0
  warn "未找到 $SERVICE.service，本次不执行停服/启服"
fi

# ---------- 1/7 停止服务 ----------
STAGE=1; say "停止服务 ($SERVICE)"
if [ "$HAVE_SERVICE" = "1" ] && systemctl is-active --quiet "$SERVICE"; then
  sudo systemctl stop "$SERVICE" || fail "停止 $SERVICE 失败"
  ok "服务已停止（SQLite 已落盘，可安全搬移）"
else
  warn "服务当前未运行，跳过停服"
fi

# ---------- 2/7 暂存服务器数据 ----------
STAGE=2; say "暂存服务器数据（.data 不参与更新）"
if [ -d "$DATA_DIR" ]; then
  mv "$DATA_DIR" "$KEEP_ROOT/data"
  DATA_MOVED=1
  ok "已暂存 $(du -sh "$KEEP_ROOT/data" | cut -f1)"
else
  warn "未找到 .data 目录，跳过"
fi

# ---------- 3/7 对齐仓库代码 ----------
STAGE=3; say "拉取最新代码 (git fetch + reset --hard origin/$BRANCH)"
[ -d .git ] || fail "当前目录不是 git 仓库，请先 git clone"
git fetch origin || fail "git fetch 失败（检查网络与仓库地址）"
# 服务器是纯部署目标，工作区若有代码改动会被丢弃；先提示再对齐
DIRTY="$(git status --porcelain -- . ':(exclude).data' || true)"
if [ -n "$DIRTY" ]; then
  warn "服务器上存在未提交的代码改动，将被丢弃："
  printf '%s\n' "$DIRTY" | sed 's/^/      /'
fi
git reset --hard "origin/$BRANCH" || fail "git reset --hard 失败"
ok "代码已对齐到 $(git rev-parse --short HEAD)"

# ---------- 4/7 还原服务器数据 ----------
STAGE=4; say "还原服务器数据"
restore_data
ok "线上数据已原样还原"

# ---------- 5/7 先起服，构建期间保持线上可用 ----------
STAGE=5; say "启动服务（沿用旧产物，先恢复线上）"
if [ "$HAVE_SERVICE" = "1" ]; then
  sudo systemctl start "$SERVICE" || fail "启动 $SERVICE 失败"
  ok "服务已恢复，构建期间站点保持可用"
else
  warn "无 $SERVICE.service，跳过"
fi

# ---------- 6/7 安装依赖并构建 ----------
STAGE=6; say "安装依赖并构建"
npm ci --no-audit --no-fund || fail "npm ci 失败"
rm -rf .nuxt .output
npm run build || fail "构建失败（线上仍在跑旧产物，可修复后重跑本脚本）"
ok "构建完成"

# ---------- 7/7 重启服务切换新产物 ----------
STAGE=7; say "重启服务 (systemd)"
if [ "$HAVE_SERVICE" = "1" ]; then
  sudo systemctl restart "$SERVICE" || fail "重启 $SERVICE 失败"
  sleep 2
  systemctl status "$SERVICE" --no-pager | head -8 || true
else
  warn "无 $SERVICE.service，请手动启动"
fi

printf "\n\033[1;32m✅ 更新完成\033[0m\n"
echo "   - 代码版本: $(git rev-parse --short HEAD)"
echo "   - 服务日志: journalctl -u $SERVICE -f"

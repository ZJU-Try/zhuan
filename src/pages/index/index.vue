<template>
  <view
    class="game"
    @touchmove="onMove"
    @mousemove="onMove"
    @touchend="onUp"
    @mouseup="onUp"
  >
    <!-- 顶部状态栏 -->
    <view class="hud">
      <view class="level-wrap">
        <text class="label">关卡</text>
        <text class="level">{{ store.level }}</text>
      </view>
      <view class="timer-wrap">
        <text class="label">用时</text>
        <text class="timer">{{ store.formatTime() }}</text>
      </view>
      <view class="status-wrap">
        <text class="status" v-if="store.won">🎉 通关</text>
        <text class="status" v-else-if="store.stuck">😢 游戏失败</text>
        <text class="status" v-else>进行中</text>
      </view>
      <button class="reset-btn" size="mini" @click="store.retryLevel()">重开</button>
    </view>

    <!-- 棋盘 -->
    <view
      class="board"
      :class="{ shake: store.invalidShake }"
      :style="boardStyle"
    >
      <template v-for="(row, r) in store.board" :key="r">
        <view
          v-for="(icon, c) in row"
          :key="r + '-' + c"
          class="cell"
          :class="{
            empty: icon === 0,
            selected:
              store.selected &&
              store.selected.row === r &&
              store.selected.col === c,
            dragging: draggingKeys.has(r + '-' + c),
            animating: animating && draggingKeys.has(r + '-' + c),
            candidate: isCandidateCell(r, c),
            shaking: isShakingCell(icon),
          }"
          :style="{ ...cellStyle(r, c), width: cellRpx + 'rpx', height: cellRpx + 'rpx' }"
          @touchstart="onDown(r, c, $event)"
          @mousedown.prevent="onDown(r, c, $event)"
          @click="onCandidateClick(r, c)"
        >
          <text v-if="icon !== 0" class="icon" :style="{ fontSize: iconFontSize + 'rpx' }">{{ ICONS[icon] }}</text>
        </view>
      </template>
    </view>

    <!-- 玩法说明 -->
    <view class="tips">
      <text>按住方块向上下左右滑动，整组方块平移；</text>
      <text>同图标“隔空相邻”可消除，多组时点选消除哪一组。</text>
    </view>

    <!-- 候选选择提示 -->
    <view v-if="store.isChoosing()" class="choose-bar">
      <text class="choose-text">发现 {{ store.candidates.length }} 组可消除，必须点选一组消除</text>
    </view>

    <!-- 通关弹层 -->
    <view v-if="store.won" class="win-mask" @touchstart.stop.prevent="noop">
      <view class="win-card">
        <text class="win-title">🎉 第 {{ store.level }} 关通关！</text>
        <text class="win-time">用时 {{ store.formatTime() }}</text>
        <button class="win-btn" @click="store.nextLevel()">下一关</button>
      </view>
    </view>

    <!-- 游戏失败弹层 -->
    <view v-if="store.stuck" class="win-mask" @touchstart.stop.prevent="noop">
      <view class="win-card">
        <text class="win-title" style="color: #f44336;">😢 游戏失败</text>
        <text class="win-time">用时 {{ store.formatTime() }}</text>
        <button class="win-btn" @click="store.retryLevel()">重新挑战本关</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { ICONS, applyMove, findPairsForCell, getMaxSlide, getRun, shiftCell } from '@/utils/gameEngine'
import type { Cell, Direction } from '@/types/game'

const store = useGameStore()

// 页面加载时初始化游戏（启动计时器）
onMounted(() => {
  store.reset()
})

const GAP_RPX = 6
const DIR_LOCK_THRESHOLD_PX = 6 // 确定方向的最小位移
const SNAP_MS = 180 // 吸附/回弹动画时长

// 动态格子大小：根据列数自适应屏幕宽度
// 可用宽度 = 750rpx(屏宽) - 48rpx(外层padding) - 24rpx(棋盘padding)
const cellRpx = computed(() => {
  const cols = store.config.cols
  const available = 750 - 48 - 24
  return Math.floor((available - (cols - 1) * GAP_RPX) / cols)
})
const stepRpx = computed(() => cellRpx.value + GAP_RPX)
const iconFontSize = computed(() => Math.floor(cellRpx.value * 0.62))

const boardStyle = computed(() => ({
  gridTemplateColumns: `repeat(${store.config.cols}, ${cellRpx.value}rpx)`,
}))

// 屏幕宽度（px），用于 px <-> rpx 换算
let screenWpx = 375
try {
  screenWpx = uni.getSystemInfoSync().windowWidth
} catch (e) {
  screenWpx = typeof window !== 'undefined' ? window.innerWidth : 375
}
const stepPx = computed(() => (stepRpx.value * screenWpx) / 750)

// 拖拽响应式状态
const dragOffsetRpx = ref(0) // 沿当前方向的正位移（>=0）
const dragDir = ref<Direction | null>(null)
const dragRun = ref<Cell[]>([])
const animating = ref(false) // 吸附或回弹动画进行中

// 拖拽非响应式状态
let dragStart: Cell | null = null
let startPoint = { x: 0, y: 0 }
let swiping = false
let maxSteps = 0 // 当前方向最大可移动格数
let lastTouchTime = 0

function getPoint(e: any): { x: number; y: number } | null {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
  if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY }
  return null
}

function isTouchEvent(e: any) {
  return !!(e.touches || e.changedTouches || e.type?.startsWith('touch'))
}

/** 根据位移确定方向与沿该方向的正投影 */
function dirFromDelta(dx: number, dy: number): { dir: Direction; proj: number } | null {
  if (Math.abs(dx) < DIR_LOCK_THRESHOLD_PX && Math.abs(dy) < DIR_LOCK_THRESHOLD_PX) return null
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? { dir: 'right', proj: dx } : { dir: 'left', proj: -dx }
  }
  return dy > 0 ? { dir: 'down', proj: dy } : { dir: 'up', proj: -dy }
}

/** 切换方向时重新计算组与最大步数 */
function refreshRun(dir: Direction) {
  if (!dragStart) return
  dragDir.value = dir
  dragRun.value = getRun(store.board, dragStart, dir)
  maxSteps = getMaxSlide(store.board, dragStart, dir)
}

function onDown(r: number, c: number, e: any) {
  if (store.won || store.stuck || store.isChoosing()) return
  if (!isTouchEvent(e) && Date.now() - lastTouchTime < 500) return
  if (isTouchEvent(e)) lastTouchTime = Date.now()

  const p = getPoint(e)
  if (!p || store.board[r][c] === 0) return

  dragStart = { row: r, col: c }
  dragDir.value = null
  dragRun.value = []
  dragOffsetRpx.value = 0
  animating.value = false
  maxSteps = 0
  startPoint = p
  swiping = true
  store.select({ row: r, col: c })
}

function onMove(e: any) {
  if (!swiping || !dragStart) return
  const p = getPoint(e)
  if (!p) return
  const res = dirFromDelta(p.x - startPoint.x, p.y - startPoint.y)
  if (!res) return

  // 方向变化时重新计算组与最大步数（组始终与当前方向一致，杜绝穿越）
  if (dragDir.value !== res.dir) refreshRun(res.dir)
  if (maxSteps <= 0) {
    dragOffsetRpx.value = 0
    return
  }

  // 沿当前方向的正位移，限制 [0, maxSteps * stepPx]
  let proj = res.proj
  if (proj < 0) proj = 0
  const maxOffsetPx = maxSteps * stepPx.value
  if (proj > maxOffsetPx) proj = maxOffsetPx
  dragOffsetRpx.value = (proj / stepPx.value) * stepRpx.value
}

function onUp(e: any) {
  if (!swiping) return
  if (!isTouchEvent(e) && Date.now() - lastTouchTime < 500) return
  swiping = false

  const start = dragStart
  const dir = dragDir.value
  store.select(null)

  // 无方向（未拖动）视为点击：尝试直接消除该方块的隔空相邻对
  if (!start || !dir) {
    if (start) store.tryClickEliminate(start)
    resetDrag()
    return
  }

  if (maxSteps <= 0) {
    // 无可移动空间，视为点击尝试直接消除
    if (start) store.tryClickEliminate(start)
    resetDrag()
    return
  }

  // 落位格数（四舍五入，至少1格）
  const steps = Math.max(1, Math.min(maxSteps, Math.round(dragOffsetRpx.value / stepRpx.value)))

  // 预判：移动后，被点击图标新位置是否有可消除对（全方向判别，与点击一致）
  const moved = applyMove(store.board, start, dir, steps)
  const movedCell = shiftCell(start, dir, steps)
  const hasMatch = !!moved && findPairsForCell(moved, movedCell).length > 0

  // 吸附到目标格
  animating.value = true
  dragOffsetRpx.value = steps * stepRpx.value

  setTimeout(() => {
    if (hasMatch) {
      store.tryMove(start, dir, steps)
      resetDrag()
    } else {
      dragOffsetRpx.value = 0
      setTimeout(resetDrag, SNAP_MS)
    }
  }, SNAP_MS)
}

function resetDrag() {
  animating.value = false
  dragStart = null
  dragDir.value = null
  dragRun.value = []
  dragOffsetRpx.value = 0
  maxSteps = 0
}

const draggingKeys = computed(() => new Set(dragRun.value.map((c) => c.row + '-' + c.col)))

function cellStyle(r: number, c: number): Record<string, string> {
  if (!draggingKeys.value.has(r + '-' + c) || !dragDir.value) return {}
  const off = dragOffsetRpx.value
  const d = dragDir.value
  let transform = ''
  if (d === 'up') transform = `translateY(${-off}rpx)`
  else if (d === 'down') transform = `translateY(${off}rpx)`
  else if (d === 'left') transform = `translateX(${-off}rpx)`
  else transform = `translateX(${off}rpx)`
  return { transform }
}

/** 候选高亮：判断该格是否为任一候选对的 target（配对方块） */
function isCandidateCell(r: number, c: number): boolean {
  if (!store.isChoosing()) return false
  return store.candidates.some((p) => p.target.row === r && p.target.col === c)
}

/** 候选点击：点选高亮方块消除其所属候选对 */
function onCandidateClick(r: number, c: number) {
  if (!store.isChoosing()) return
  const pair = store.candidates.find((p) => p.target.row === r && p.target.col === c)
  if (pair) store.chooseAndEliminate(pair)
}

/** 判断该图标是否需要抖动（点击未消除时，所有相同图标方块抖动） */
function isShakingCell(icon: number): boolean {
  return store.shakeIconId !== null && store.shakeIconId === icon
}

function noop() {
  /* 阻止穿透 */
}
</script>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24rpx;
  box-sizing: border-box;
}

/* 顶部状态栏 */
.hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 680rpx;
  margin-bottom: 28rpx;
}
.level-wrap,
.timer-wrap,
.status-wrap {
  display: flex;
  flex-direction: column;
}
.label {
  font-size: 22rpx;
  color: #999;
}
.level {
  font-size: 44rpx;
  font-weight: bold;
  color: #ff9800;
  font-variant-numeric: tabular-nums;
}
.timer {
  font-size: 44rpx;
  font-weight: bold;
  color: #333;
  font-variant-numeric: tabular-nums;
}
.status {
  font-size: 28rpx;
  color: #666;
}
.reset-btn {
  font-size: 24rpx;
}

/* 棋盘 */
.board {
  display: grid;
  gap: 6rpx;
  padding: 12rpx;
  background: #d7d9de;
  border-radius: 16rpx;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.cell {
  position: relative;
  background: #ffffff;
  border-radius: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.06);
  will-change: transform;
}
.cell.empty {
  background: rgba(0, 0, 0, 0.04);
  box-shadow: none;
}
.cell.selected {
  outline: 4rpx solid #ff9800;
  outline-offset: -4rpx;
}
.cell.dragging {
  z-index: 10;
  box-shadow: 0 6rpx 12rpx rgba(0, 0, 0, 0.18);
}
.cell.animating {
  transition: transform 0.18s ease;
}
.cell.candidate {
  outline: 4rpx solid #ff5722;
  outline-offset: -4rpx;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 4rpx rgba(255, 87, 34, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8rpx rgba(255, 87, 34, 0.15);
  }
}
.icon {
  line-height: 1;
  pointer-events: none;
}

/* 抖动 */
.shake {
  animation: shake 0.3s ease;
}

/* 点击未消除时，相同图标方块的抖动动画 */
.cell.shaking {
  animation: shakeCell 0.4s ease;
}
@keyframes shakeCell {
  0%,
  100% {
    transform: translateX(0);
  }
  15% {
    transform: translateX(-6rpx);
  }
  30% {
    transform: translateX(6rpx);
  }
  45% {
    transform: translateX(-5rpx);
  }
  60% {
    transform: translateX(5rpx);
  }
  75% {
    transform: translateX(-3rpx);
  }
  90% {
    transform: translateX(3rpx);
  }
}

/* 玩法说明 */
.tips {
  margin-top: 28rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}
.tips text {
  font-size: 24rpx;
  color: #999;
}

/* 候选选择条 */
.choose-bar {
  margin-top: 24rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 24rpx;
  background: #fff3e0;
  border: 2rpx solid #ffb74d;
  border-radius: 12rpx;
}
.choose-text {
  font-size: 26rpx;
  color: #e65100;
}

/* 通关弹层 */
.win-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}
.win-card {
  width: 480rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 48rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}
.win-title {
  font-size: 48rpx;
  font-weight: bold;
  color: #4caf50;
}
.win-time {
  font-size: 36rpx;
  color: #333;
}
.win-btn {
  width: 320rpx;
  margin-top: 8rpx;
}
</style>

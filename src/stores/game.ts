import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Cell, Direction, GameConfig, IconId, MatchPair } from '@/types/game'
import {
  applyMove,
  eliminate,
  findPairsForCell,
  generateBoard,
  getLevelConfig,
  isCleared,
  isStuck,
  shiftCell,
} from '@/utils/gameEngine'

export const useGameStore = defineStore('game', () => {
  /** 当前关卡（从 1 开始） */
  const level = ref(1)
  const config = ref<GameConfig>(getLevelConfig(1))
  const board = ref(generateBoard(config.value))
  const selected = ref<Cell | null>(null)
  const elapsedMs = ref(0)
  const started = ref(false)
  const won = ref(false)
  /** 无棋可走（游戏失败） */
  const stuck = ref(false)
  /** 非法/无效移动反馈（用于抖动动画） */
  const invalidShake = ref(false)
  /** 点击未消除时，抖动矩阵中所有该图标的方块 */
  const shakeIconId = ref<IconId | null>(null)

  /** 候选选择态：移动已落位但存在多个可消除对时，等待玩家选择消除哪一对 */
  const pendingBoard = ref<import('@/types/game').Board | null>(null)
  const candidates = ref<MatchPair[]>([])

  let timerId: ReturnType<typeof setInterval> | null = null
  let lastTick = 0

  function startTimer() {
    if (timerId || won.value) return
    started.value = true
    lastTick = Date.now()
    timerId = setInterval(() => {
      const now = Date.now()
      elapsedMs.value += now - lastTick
      lastTick = now
    }, 250)
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId)
      timerId = null
    }
  }

  function formatTime(): string {
    const total = Math.floor(elapsedMs.value / 1000)
    const m = Math.floor(total / 60)
      .toString()
      .padStart(2, '0')
    const s = (total % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  function select(cell: Cell | null) {
    selected.value = cell
  }

  function flashInvalid() {
    invalidShake.value = true
    setTimeout(() => {
      invalidShake.value = false
    }, 300)
  }

  /** 是否处于候选选择态 */
  function isChoosing() {
    return pendingBoard.value !== null
  }

  /** 取消候选选择（保留供内部使用，UI 不暴露：规则要求必须选择消除） */
  function cancelChoose() {
    pendingBoard.value = null
    candidates.value = []
  }

  function checkWin() {
    if (isCleared(board.value)) {
      won.value = true
      stopTimer()
    } else if (isStuck(board.value)) {
      stuck.value = true
      stopTimer()
    }
  }

  /**
   * 执行一次移动：
   * 1. 计算移动后矩阵（不立即提交）
   * 2. 若移动非法 -> 抖动反馈并恢复
   * 3. 仅判别被点击图标（移动后新位置）沿垂直于移动方向的消除对：
   *    - 水平移动 -> 只判别上下方向；垂直移动 -> 只判别左右方向
   *    - 无可消除对 -> 抖动反馈并恢复（规则：无可消除则恢复移动前矩阵）
   *    - 仅一对 -> 提交移动，消除该对，未消除方块留在移动后位置
   *    - 多对 -> 提交移动到盘面，进入候选选择态，玩家必须选一组
   * 4. 全部图标消除则通关，停止计时
   */
  function tryMove(start: Cell, dir: Direction, steps: number) {
    if (won.value || stuck.value || isChoosing()) return

    const moved = applyMove(board.value, start, dir, steps)
    if (!moved) {
      flashInvalid()
      return
    }

    const movedCell = shiftCell(start, dir, steps)
    // 与点击消除逻辑一致：判别全部四方向（上下左右）
    const pairs = findPairsForCell(moved, movedCell)
    if (pairs.length === 0) {
      // 无可消除对象：恢复移动前矩阵（moved 未提交即等于恢复）
      flashInvalid()
      return
    }

    // 提交移动到盘面
    board.value = moved

    if (pairs.length === 1) {
      // 仅一对：消除该对，未消除方块留在移动后位置
      board.value = eliminate(board.value, [pairs[0].anchor, pairs[0].target])
      checkWin()
    } else {
      // 多对：高亮候选，进入候选选择态，玩家必须选一组
      pendingBoard.value = moved
      candidates.value = pairs
    }
  }

  /** 玩家选择消除某一候选对（消除该对，未消除方块留在移动后位置） */
  function chooseAndEliminate(pair: MatchPair) {
    if (!pendingBoard.value) return
    board.value = eliminate(board.value, [pair.anchor, pair.target])
    pendingBoard.value = null
    candidates.value = []
    checkWin()
  }

  /**
   * 直接点击消除：点击一个已有隔空相邻对的方块，无需移动直接消除。
   * 判别全部四方向（上下左右），与移动触发的消除一致（仅判别该方块）：
   * - 无可消除对 -> 抖动矩阵中所有相同图标方块
   * - 仅一对 -> 直接消除
   * - 多对（上下左右存在多个相同图标）-> 高亮候选，进入候选选择态
   */
  function tryClickEliminate(cell: Cell) {
    if (won.value || stuck.value || isChoosing()) return
    if (board.value[cell.row][cell.col] === 0) return
    const pairs = findPairsForCell(board.value, cell)
    if (pairs.length === 0) {
      // 无消除：抖动矩阵中所有相同图标方块
      shakeIconId.value = board.value[cell.row][cell.col]
      setTimeout(() => {
        shakeIconId.value = null
      }, 400)
      return
    }

    if (pairs.length === 1) {
      board.value = eliminate(board.value, [pairs[0].anchor, pairs[0].target])
      checkWin()
    } else {
      // 多对：高亮候选，进入候选选择态
      pendingBoard.value = board.value
      candidates.value = pairs
    }
  }

  /** 初始化指定关卡的棋盘 */
  function startLevel(lv: number) {
    stopTimer()
    level.value = lv
    config.value = getLevelConfig(lv)
    // generateBoard 内部已保证生成的棋盘不是死局（玩家一定有可消除操作）
    board.value = generateBoard(config.value)
    selected.value = null
    elapsedMs.value = 0
    started.value = false
    won.value = false
    stuck.value = false
    invalidShake.value = false
    shakeIconId.value = null
    pendingBoard.value = null
    candidates.value = []
    // 计时器从游戏开始就运行
    startTimer()
    // 安全兜底：理论上 generateBoard 已保证非死局，此处仅作防御性检测
    if (isStuck(board.value)) {
      board.value = generateBoard(config.value)
    }
  }

  /** 进入下一关 */
  function nextLevel() {
    startLevel(level.value + 1)
  }

  /** 重新挑战当前关 */
  function retryLevel() {
    startLevel(level.value)
  }

  /** 从第 1 关重新开始整个游戏 */
  function reset() {
    startLevel(1)
  }

  return {
    level,
    config,
    board,
    selected,
    elapsedMs,
    started,
    won,
    stuck,
    invalidShake,
    shakeIconId,
    candidates,
    formatTime,
    select,
    tryMove,
    tryClickEliminate,
    nextLevel,
    retryLevel,
    reset,
    isChoosing,
    cancelChoose,
    chooseAndEliminate,
  }
})

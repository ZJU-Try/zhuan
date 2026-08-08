import type { Board, Cell, Direction, GameConfig, IconId, MatchPair } from '@/types/game'

/** 默认配置（第 1 关）：8x10，8 种图标 */
export const DEFAULT_CONFIG: GameConfig = {
  rows: 8,
  cols: 10,
  iconCount: 8,
}

/**
 * 图标素材（按 IconId 索引，0 为空）。
 * 可替换为图片路径，UI 层按 id 取用。
 */
export const ICONS: string[] = [
  '', '🍎', '🍊', '🍋', '🍇', '🍓', '🍑', '🍒', '🥝',
  '🍍', '🥭', '🍌', '🍉', '🍐', '🥥', '🥑', '🍈', '🍅', '🍆', '🫐',
  '🥔', '🥕', '🌽', '🌶️', '🫑', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🥨',
]

/**
 * 根据关卡数计算游戏配置。
 * 公式：关卡数 n，矩阵 = (8 + floor(n/5)) × (10 + floor(n/5))，图标种类 = 8 + floor(n/5)
 */
export function getLevelConfig(level: number): GameConfig {
  const step = Math.floor(level / 5)
  return {
    rows: 10 + step,
    cols: 8 + step,
    iconCount: 12 + step,
  }
}

/** 各方向的行列增量 */
const DELTA: Record<Direction, Cell> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
}

/** 将方块沿方向平移 steps 格，返回新位置 */
export function shiftCell(cell: Cell, dir: Direction, steps: number): Cell {
  const d = DELTA[dir]
  return { row: cell.row + d.row * steps, col: cell.col + d.col * steps }
}

/** 反方向 */
export function opposite(dir: Direction): Direction {
  return dir === 'left' ? 'right' : dir === 'right' ? 'left' : dir === 'up' ? 'down' : 'up'
}

/** 从 cell 沿 dir 的连续空格数（不包含 cell 本身） */
export function countEmptyAhead(board: Board, cell: Cell, dir: Direction): number {
  const d = DELTA[dir]
  const rows = board.length
  const cols = board[0].length
  let steps = 0
  let r = cell.row + d.row
  let c = cell.col + d.col
  while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === 0) {
    steps++
    r += d.row
    c += d.col
  }
  return steps
}

export function createEmptyBoard(rows: number, cols: number): Board {
  return Array.from({ length: rows }, () => Array<IconId>(cols).fill(0))
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice())
}

/**
 * 计算从起始格出发、沿滑动方向的"连续相邻方块"组（核心移动范围）。
 * 规则：起始格必须非空；从起始格沿方向 D 连续取非空方块，遇到空格或边界停止。
 * 起始格是该组的尾端（被推动的一端），最远端为头端。
 */
export function getRun(board: Board, start: Cell, dir: Direction): Cell[] {
  const rows = board.length
  const cols = board[0].length
  const d = DELTA[dir]
  const run: Cell[] = []

  if (board[start.row][start.col] === 0) return run
  run.push({ row: start.row, col: start.col })

  let r = start.row + d.row
  let c = start.col + d.col
  while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] !== 0) {
    run.push({ row: r, col: c })
    r += d.row
    c += d.col
  }
  return run
}

/**
 * 计算整组沿方向可滑动的最大格数。
 * 头端（组的最远端）前方连续空格数即为最大可滑动格数；
 * 碰到边界或非空方块即停。
 */
export function getMaxSlide(board: Board, start: Cell, dir: Direction): number {
  const run = getRun(board, start, dir)
  if (run.length === 0) return 0
  const d = DELTA[dir]
  const lead = run[run.length - 1]
  const rows = board.length
  const cols = board[0].length
  let steps = 0
  let r = lead.row + d.row
  let c = lead.col + d.col
  while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === 0) {
    steps++
    r += d.row
    c += d.col
  }
  return steps
}

/**
 * 尝试移动：将整组沿方向平移 steps 格。
 * 仅当 steps 不超过头端前方连续空格数（getMaxSlide）时合法。
 * 返回移动后的新矩阵；若非法返回 null。
 */
export function applyMove(
  board: Board,
  start: Cell,
  dir: Direction,
  steps: number,
): Board | null {
  if (steps <= 0) return null
  if (steps > getMaxSlide(board, start, dir)) return null
  const run = getRun(board, start, dir)
  if (run.length === 0) return null

  const d = DELTA[dir]
  const next = cloneBoard(board)
  const icons = run.map((cell) => board[cell.row][cell.col])
  // 清空原组位置
  for (const cell of run) next[cell.row][cell.col] = 0
  // 整体平移 steps 格写入
  for (let i = 0; i < run.length; i++) {
    const cell = run[i]
    next[cell.row + d.row * steps][cell.col + d.col * steps] = icons[i]
  }
  return next
}

/**
 * 查找所有可消除的"对"（隔空相邻规则）。
 * 规则：同一行/列中，跳过空格后的"相邻两个非空方块"若图标相同，则二者构成一对可消除候选。
 * （即两同图标之间只允许存在空格，不得有其它图标阻挡）
 * 返回去重后的候选对列表（每对两个方块）。
 */
export function findCandidateGroups(board: Board): MatchPair[] {
  const rows = board.length
  const cols = board[0].length
  const seen = new Set<string>()
  const pairs: MatchPair[] = []
  const key = (a: Cell, b: Cell) =>
    a.row < b.row || (a.row === b.row && a.col < b.col)
      ? `${a.row},${a.col}|${b.row},${b.col}`
      : `${b.row},${b.col}|${a.row},${a.col}`

  // 扫描单条线（行或列），收集相邻非空同图标对
  const scanLine = (len: number, get: (i: number) => { cell: Cell; icon: IconId } | null) => {
    let prev: { cell: Cell; icon: IconId } | null = null
    for (let i = 0; i < len; i++) {
      const cur = get(i)
      if (!cur) continue // 空格：保留 prev 不变（隔空相邻），仅跳过
      if (prev && prev.icon === cur.icon) {
        const k = key(prev.cell, cur.cell)
        if (!seen.has(k)) {
          seen.add(k)
          pairs.push({ anchor: prev.cell, target: cur.cell, icon: prev.icon })
        }
      }
      prev = cur
    }
  }

  // 逐行
  for (let r = 0; r < rows; r++) {
    scanLine(cols, (c) => {
      const icon = board[r][c]
      return icon === 0 ? null : { cell: { row: r, col: c }, icon }
    })
  }
  // 逐列
  for (let c = 0; c < cols; c++) {
    scanLine(rows, (r) => {
      const icon = board[r][c]
      return icon === 0 ? null : { cell: { row: r, col: c }, icon }
    })
  }
  return pairs
}

/**
 * 查找与指定方块构成"隔空相邻"对的所有方块。
 * 规则：从该方块出发，沿上/下/左/右四个方向各跳过空格，
 * 遇到的第一个非空方块若图标相同，则二者构成一对可消除候选。
 * 最多返回 4 对（每方向最多 1 对）。
 * 用于：移动触发和点击触发的消除判别（统一逻辑，全方向判别）。
 */
export function findPairsForCell(board: Board, cell: Cell): MatchPair[] {
  const rows = board.length
  const cols = board[0].length
  const icon = board[cell.row][cell.col]
  if (icon === 0) return []

  const dirs = [
    { dr: 0, dc: -1 }, // 左
    { dr: 0, dc: 1 }, // 右
    { dr: -1, dc: 0 }, // 上
    { dr: 1, dc: 0 }, // 下
  ]

  const pairs: MatchPair[] = []
  for (const { dr, dc } of dirs) {
    let r = cell.row + dr
    let c = cell.col + dc
    // 跳过空格
    while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === 0) {
      r += dr
      c += dc
    }
    // 第一个非空方块若同图标，构成一对
    if (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === icon) {
      pairs.push({ anchor: cell, target: { row: r, col: c }, icon })
    }
  }
  return pairs
}

/** @deprecated 用 findCandidateGroups（返回成对候选）。保留供旧逻辑过渡。 */
export function findMatches(board: Board): Cell[] {
  return findCandidateGroups(board).flatMap((p) => [p.anchor, p.target])
}

/** 消除指定方块（置空），返回新矩阵 */
export function eliminate(board: Board, cells: Cell[]): Board {
  const next = cloneBoard(board)
  for (const { row, col } of cells) next[row][col] = 0
  return next
}

/** 是否已消除全部图标（通关） */
export function isCleared(board: Board): boolean {
  for (const row of board) {
    for (const icon of row) {
      if (icon !== 0) return false
    }
  }
  return true
}

/**
 * 判断是否已无棋可走：
 * 1. 无可点击消除对（findCandidateGroups 返回空）
 * 2. 无任何移动能创造新消除对
 */
export function isStuck(board: Board): boolean {
  if (findCandidateGroups(board).length > 0) return false
  if (canAnyMoveCreatePair(board)) return false
  return true
}

/**
 * 判断是否存在某个移动能使被点击图标产生消除对。
 * 遍历每个非空格子的四个方向，尝试移动后判别。
 */
function canAnyMoveCreatePair(board: Board): boolean {
  const rows = board.length
  const cols = board[0].length
  const dirs: Direction[] = ['up', 'down', 'left', 'right']

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] === 0) continue
      const cell: Cell = { row: r, col: c }
      for (const dir of dirs) {
        const maxSteps = getMaxSlide(board, cell, dir)
        for (let steps = 1; steps <= maxSteps; steps++) {
          const moved = applyMove(board, cell, dir, steps)
          if (!moved) break
          const movedCell = shiftCell(cell, dir, steps)
          if (findPairsForCell(moved, movedCell).length > 0) return true
        }
      }
    }
  }
  return false
}

/**
 * 生成初始矩阵：
 * - 图标成对放置（每种图标数量为偶数），避免出现落单导致无法消除
 * - emptyRatio=0 时无空格（初始盘面填满），允许初始相邻配对供玩家开局
 * - emptyRatio>0 时含一定比例空格，无初始可消除对
 * - 保证生成的棋盘一定存在可进行的消除操作（当前可消除或通过移动可创造消除），避免死局开局
 */
export function generateBoard(config: GameConfig, emptyRatio = 0): Board {
  const { rows, cols, iconCount } = config

  const total = rows * cols
  const hasEmpties = emptyRatio > 0
  const emptyCount = hasEmpties
    ? Math.max(2, Math.round(total * emptyRatio))
    : 0

  let guard = 0
  // 外层循环：确保生成的棋盘不是死局（必须存在可行的消除操作）
  while (guard < 500) {
    const board = createEmptyBoard(rows, cols)
    const indices = shuffle([...Array(total).keys()])
    const emptySet = new Set(indices.slice(0, emptyCount))

    // 剩余位置成对分配图标
    const fillCells: number[] = []
    for (let i = 0; i < total; i++) if (!emptySet.has(i)) fillCells.push(i)
    // 若剩余为奇数，多留一个空格使其成对
    if (fillCells.length % 2 !== 0) {
      const extra = fillCells.pop()!
      emptySet.add(extra)
    }

    shuffle(fillCells)
    let innerGuard = 0
    let pairs = fillCells.length / 2
    // 无空格模式：追踪消除对最少的棋盘，提高离散度
    let bestBoard: Board | null = null
    let bestPairCount = Infinity
    // 从图标库中随机选取 iconCount 种图标（不固定使用前 N 种）
    const allIconIds: IconId[] = []
    for (let i = 1; i < ICONS.length; i++) allIconIds.push(i)
    shuffle(allIconIds)
    const selectedIcons = allIconIds.slice(0, iconCount)
    // 内层循环：尝试满足初始配对条件
    while (innerGuard < 60) {
      const iconsPool: IconId[] = []
      for (let p = 0; p < pairs; p++) {
        const icon = selectedIcons[p % iconCount]
        iconsPool.push(icon, icon)
      }
      shuffle(iconsPool)
      for (let i = 0; i < fillCells.length; i++) {
        const idx = fillCells[i]
        board[Math.floor(idx / cols)][idx % cols] = iconsPool[i]
      }
      // 有空格时禁止初始配对（需通过移动创造配对）；无空格时选消除对最少的
      if (hasEmpties) {
        if (findCandidateGroups(board).length === 0) break
      } else {
        const pairCount = findCandidateGroups(board).length
        if (pairCount > 0 && pairCount < bestPairCount) {
          bestPairCount = pairCount
          bestBoard = cloneBoard(board)
        }
      }
      innerGuard++
    }

    // 无空格模式使用消除对最少的棋盘
    if (!hasEmpties && bestBoard) {
      if (!isStuck(bestBoard)) return bestBoard
    }
    // 关键：确保初始棋盘不是死局，玩家一定有可进行的消除操作
    if (!isStuck(board)) {
      return board
    }
    guard++
  }

  // 兜底：若多次尝试仍找不到非死局棋盘，手动构造一个保证有可消除对的棋盘
  return buildGuaranteedBoard(config)
}

/**
 * 兜底构造函数：手动生成一个保证存在初始可消除对的棋盘，避免极端情况下死循环
 */
function buildGuaranteedBoard(config: GameConfig): Board {
  const { rows, cols, iconCount } = config
  const board = createEmptyBoard(rows, cols)
  // 先填满棋盘，保证偶数对
  const total = rows * cols
  const pairs = Math.floor(total / 2)
  // 随机选取图标
  const allIconIds: IconId[] = []
  for (let i = 1; i < ICONS.length; i++) allIconIds.push(i)
  shuffle(allIconIds)
  const selectedIcons = allIconIds.slice(0, iconCount)
  const iconsPool: IconId[] = []
  for (let p = 0; p < pairs; p++) {
    const icon = selectedIcons[p % iconCount]
    iconsPool.push(icon, icon)
  }
  shuffle(iconsPool)
  for (let i = 0; i < pairs * 2; i++) {
    board[Math.floor(i / cols)][i % cols] = iconsPool[i]
  }
  // 强制在第一行创造两个相邻的相同图标，确保至少有一对可消除
  if (cols >= 2) {
    const safeIcon = selectedIcons[0]
    board[0][0] = safeIcon
    board[0][1] = safeIcon
  }
  return board
}

/** Fisher–Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

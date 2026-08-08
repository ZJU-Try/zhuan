/** 0 表示空格，1..N 表示不同图标 */
export type IconId = number

/** 二维矩阵：board[row][col] */
export type Board = IconId[][]

export interface Cell {
  row: number
  col: number
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/** 轴：水平(left/right) 或 垂直(up/down) */
export type Axis = 'horizontal' | 'vertical'

export interface GameConfig {
  rows: number
  cols: number
  iconCount: number
}

/** 一对可消除的方块（隔空相邻、同图标） */
export interface MatchPair {
  /** 被操作的方块（起点：被点击或移动的那个） */
  anchor: Cell
  /** 配对的方块（终点：需要高亮让玩家选择的那个） */
  target: Cell
  icon: IconId
}

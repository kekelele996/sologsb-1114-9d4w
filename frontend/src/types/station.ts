/** 测量读数的使用状态：由测量组决定 */
export const READING_STATUSES = ['adopted', 'archived', 'pending'] as const
export type ReadingStatus = (typeof READING_STATUSES)[number]

/** Station 测点：由方位角与斜距自动推算水平距与垂距 */
export interface Station {
  id: string
  segmentId: string
  /** 测点桩号，如 P12；补测可在同一桩号保留多条读数 */
  code: string
  /** 前视方位角（十进制度，0-360） */
  bearing: number
  /** 倾角（十进制度，-90 ~ 90） */
  dip: number
  /** 斜距（米） */
  slopeDistance: number
  /** 水平距（米），由斜距与倾角推算） */
  horizontalDistance: number
  /** 垂距（米），由斜距与倾角推算） */
  verticalDistance: number
  /** 仪器号；是否听标定结论 */
  instrumentNo: string
  /** 测量人 */
  surveyor: string
  /** 测量日期 */
  date: string
  /** 是否闭合点 */
  isClosurePoint: boolean
  /** 读数使用状态：采用 / 留档 / 待确认 */
  readingStatus: ReadingStatus
  /** 补测读数 */
  isResurvey: boolean
  note: string
}

export interface ClosureResult {
  /** 闭合差（米） */
  closure: number
  /** 阈值（米） */
  threshold: number
  /** 是否超限 */
  over: boolean
  level: '优' | '良' | '超限'
  /** 参与正式计算的测点数 */
  count: number
  /** 累计水平位移（东向 / 北向） */
  east: number
  north: number
  /** 计算过程说明 */
  detail: string
  /** 未进入正式成果的读数，按原因列出 */
  excluded: ExcludedReading[]
}

export interface ExcludedReading {
  station: Station
  reason: string
}

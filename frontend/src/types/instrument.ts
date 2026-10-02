/** 仪器状态（仪器室口径）：在用 / 停用 */
export type InstrumentStatus = '在用' | '停用'

/** 标定结论（仪器室口径） */
export type CalibrationConclusion = '合格' | '不合格'

/** Instrument 仪器标定档案：由仪器室持有，记录每台仪器的标定日期、有效期与结论 */
export interface Instrument {
  id: string
  /** 仪器号，与测点读数的 instrumentNo 对应，如 SOKKIA-2 */
  instrumentNo: string
  /** 仪器名称 */
  name: string
  /** 型号 */
  model: string
  /** 标定日期（YYYY-MM-DD） */
  calibrationDate: string
  /** 有效期至（YYYY-MM-DD） */
  validUntil: string
  /** 标定结论 */
  conclusion: CalibrationConclusion
  /** 仪器状态：停用后用它测出的读数不再进正式成果 */
  status: InstrumentStatus
  /** 档案备注 */
  note: string
  createdAt: string
}

/** 仪器标定结论 */
export const CALIBRATION_RESULTS = ['合格', '限用', '不合格'] as const
export type CalibrationResult = (typeof CALIBRATION_RESULTS)[number]

/** Instrument 仪器标定档案：由仪器室维护 */
export interface Instrument {
  id: string
  /** 仪器号，与测点读数 instrumentNo 对账 */
  code: string
  /** 仪器名称/型号 */
  name: string
  /** 标定日期（YYYY-MM-DD） */
  calibrationDate: string
  /** 标定有效期至（YYYY-MM-DD） */
  validUntil: string
  /** 标定结论 */
  calibrationResult: CalibrationResult
  /** 仪器室是否停用 */
  retired: boolean
  note: string
}

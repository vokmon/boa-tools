/** The candle fields the signal reads. `from` is the candle start in unix seconds. */
export interface Candle {
  from: number;
  open: number;
  close: number;
  /** Low. */
  min: number;
  /** High. */
  max: number;
  /** Traded volume; IQ Option reports 0 for OTC assets. Only the optional volume rule reads it. */
  volume?: number;
}

export type Direction = "call" | "put";

/** Signal per candle in an Int8Array: CALL = 1, PUT = -1, no signal = 0. */
export const CALL = 1;
export const PUT = -1;
export const NO_SIGNAL = 0;

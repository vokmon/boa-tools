/** One candle exactly as the broker returns it. `at` is in nanoseconds. */
export interface RawCandle {
  id: number;
  from: number;
  to: number;
  open: number;
  close: number;
  min: number;
  max: number;
  volume: number;
  at: number | undefined;
}

export interface UnderlyingInfo {
  activeId: number;
  name: string;
  isOtc: boolean;
  precision: number | null;
}

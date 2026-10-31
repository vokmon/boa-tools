/**
 * Every knob of the bot's signal. Defaults are the values iq-robot uses today
 * (`signalWithCandleCalculator.ts` with an empty config). A PUT needs all of the "PUT" rules below,
 * a CALL the mirrored ones.
 */
export interface SignalSettings {
  /** Closed candles the bot looks at for each signal (iq-robot CANDLE_NUMBER). */
  windowSize: number;

  /** Each rule can be switched off, so any combination can be tried from a settings file. The bot uses all of them. */
  useSupportResistance: boolean;
  useDonchian: boolean;
  useBollinger: boolean;
  useStochastic: boolean;
  /** The stochastic also needs %D past the level, not only %K (iq-robot before 27/10/2026). */
  stochasticUseD: boolean;

  /** Support/resistance box: the highest high / lowest low of this many candles. */
  supportResistancePeriod: number;
  /** PUT: the candle's high is at least this far (0-1) into the upper half of the box. */
  zonePositionThreshold: number;

  /** PUT: the candle's high breaks the previous candle's Donchian high of this many candles. */
  donchianPeriod: number;

  /** PUT: the candle's high is above the upper Bollinger band (closes over this period). */
  bollingerPeriod: number;
  /** Width of the Bollinger bands in standard deviations. */
  bollingerStdDev: number;

  stochasticKPeriod: number;
  stochasticDPeriod: number;
  stochasticSmoothing: number;
  /** PUT: stochastic %K above this. */
  stochasticKOverbought: number;
  /** CALL: stochastic %K below this. */
  stochasticKOversold: number;
  /** PUT: stochastic %D above this. */
  stochasticDOverbought: number;
  /** CALL: stochastic %D below this. */
  stochasticDOversold: number;

  /** PUT: at least this many green candles in a row, ending with the signal candle. */
  consecutiveCandles: number;
  /** The candle body is at least this share (0-1) of its high-low range. */
  minBodyRatio: number;
  /** PUT: the upper wick is less than this share of the range (lower wick for CALL). */
  maxRejectionWickRatio: number;
  /** The body and wick rules apply to this many latest candles. */
  candlesToCheckBodyAndWicks: number;

  /** The latest this-many candles must not be small... */
  candlesToCheckSize: number;
  /** ...compared with the average body of this many candles before them... */
  sizeLookback: number;
  /** ...each body at least this share of that average. */
  minCandleSizeRatio: number;
}

export const DEFAULT_SIGNAL_SETTINGS: Readonly<SignalSettings> = Object.freeze({
  windowSize: 100,
  useSupportResistance: true,
  useDonchian: true,
  useBollinger: true,
  useStochastic: true,
  stochasticUseD: true,
  supportResistancePeriod: 25,
  zonePositionThreshold: 0.92,
  donchianPeriod: 20,
  bollingerPeriod: 14,
  bollingerStdDev: 2,
  stochasticKPeriod: 13,
  stochasticDPeriod: 3,
  stochasticSmoothing: 3,
  stochasticKOverbought: 85,
  stochasticKOversold: 15,
  stochasticDOverbought: 85,
  stochasticDOversold: 15,
  consecutiveCandles: 3,
  minBodyRatio: 0.6,
  maxRejectionWickRatio: 0.25,
  candlesToCheckBodyAndWicks: 1,
  candlesToCheckSize: 3,
  // iq-robot: max(minCandleSizeLookbackPeriod 25, floor(windowSize 100 * lookbackPercentage 0.35))
  sizeLookback: 35,
  minCandleSizeRatio: 0.75,
});

export function withDefaults(settings: Partial<SignalSettings> = {}): SignalSettings {
  return { ...DEFAULT_SIGNAL_SETTINGS, ...settings };
}

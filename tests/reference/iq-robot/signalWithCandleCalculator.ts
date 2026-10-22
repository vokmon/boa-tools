// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
// This version has the additional logic to
// - include number of candles to check for body and wicks
// - Check if the last N consecutive candles are not abnormally short (revised logic)
// - No Rsi, strick stochastic k and d to 95 and 5

import { SignalType } from "./types/signal/Signal";
import { calculateSupportResistance } from "./indicators/supportResistance";
import { calculateDonchianForCandles } from "./indicators/donchian";
import { calculateBollingerBandsForCandles } from "./indicators/bollingerBands";
import { calculateStochasticForCandles } from "./indicators/stochastic";
import { calculateRSIForCandles } from "./indicators/rsi";
import { calculateConsecutiveCandleColors } from "./indicators/consecutiveCandleColors";
import { Candle } from "@quadcode-tech/client-sdk-js";

// ============================================================================
// Constants
// ============================================================================

// Stochastic analysis thresholds
const STOCHASTIC_K_OVERBOUGHT_THRESHOLD = 85; // default value is 80
const STOCHASTIC_K_OVERSOLD_THRESHOLD = 15; // default value is 20
const STOCHASTIC_D_OVERBOUGHT_THRESHOLD = 85; // default value is 80
const STOCHASTIC_D_OVERSOLD_THRESHOLD = 15; // default value is 20

// Candle analysis thresholds
const MIN_BODY_RATIO = 0.6; // Body must be at least 60% of total range
const MAX_REJECTION_WICK_RATIO = 0.25; // Rejection wick must be less than 25% of total range
const NUMBER_OF_CANDLES_TO_CHECK_BODY_AND_WICKS = 1;
const NUMBER_OF_CONSECUTIVE_CANDLES = 3;

// Candle size validation constants
const NUMBER_OF_CANDLES_TO_CHECK_MIN_SIZE = 3;
const MIN_CANDLE_SIZE_LOOKBACK_PERIOD = 25;
const LOOKBACK_PERCENTAGE = 0.35; // Use 35% of available candles for lookback
const MIN_CANDLE_SIZE_RATIO = 0.75; // Candle must be ≥75% of average

// Support/Resistance zone threshold
const ZONE_POSITION_THRESHOLD = 0.92; // Must be ≥90% into the zone

// ============================================================================
// Types
// ============================================================================

export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SignalCalculationConfig {
  supportResistancePeriod?: number; // Default: 25
  donchianPeriod?: number; // Default: 20
  bollingerPeriod?: number; // Default: 14
  bollingerStdDev?: number; // Default: 2
  stochasticKPeriod?: number; // Default: 13
  stochasticDPeriod?: number; // Default: 3
  stochasticSmoothing?: number; // Default: 3
  stochasticKOverboughtThreshold?: number; // Default: 90
  stochasticKOversoldThreshold?: number; // Default: 10
  stochasticDOverboughtThreshold?: number; // Default: 90
  stochasticDOversoldThreshold?: number; // Default: 10
  rsiPeriod?: number; // Default: 14
  rsiOverboughtThreshold?: number; // Default: 70
  rsiOversoldThreshold?: number; // Default: 30
  minCandles?: number; // Default: 20
  minCandlesToCheckSize?: number; // Default: 3
  minCandleSizeLookbackPeriod?: number; // Default: 25
  lookbackPercentage?: number; // Default: 0.35
  minCandleSizeRatio?: number; // Default: 0.75
  zonePositionThreshold?: number; // Default: 0.9
}

export interface SignalResult {
  signal: SignalType;
  details: {
    isNearResistance: boolean;
    isNearSupport: boolean;
    resistanceZoneHeight: number;
    supportZoneHeight: number;
    resistanceZonePosition: number; // 0-1, how close to resistance
    supportZonePosition: number; // 0-1, how close to support
    donchianBreakout: {
      upper: boolean;
      lower: boolean;
    };
    bollingerPosition: {
      aboveUpper: boolean;
      belowLower: boolean;
    };
    stochasticPosition: {
      overbought: boolean;
      oversold: boolean;
      kValue: number;
      dValue: number;
    };
    consecutiveCandles: number;
    rsiValue: number; // Kept for backward compatibility
    aboveUpperBB: boolean;
    belowLowerBB: boolean;
    candleAnalysis: {
      bodySize: number;
      bodyRatio: number;
      upperWick: number;
      upperWickRatio: number;
      lowerWick: number;
      lowerWickRatio: number;
      hasValidBody: boolean;
      hasSmallUpperWick: boolean;
      hasSmallLowerWick: boolean;
    };
    candleSizeValidation: {
      isValid: boolean;
      averageRange: number;
      checkedCandles: number;
      minRequiredSize: number;
    };
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

const defaultEmptyCandleMetrics = {
  bodySize: 0,
  bodyRatio: 0,
  upperWick: 0,
  upperWickRatio: 0,
  lowerWick: 0,
  lowerWickRatio: 0,
  hasValidBody: false,
  hasSmallUpperWick: false,
  hasSmallLowerWick: false,
};

const defaultEmptyDetails = (): SignalResult["details"] => ({
  isNearResistance: false,
  isNearSupport: false,
  resistanceZoneHeight: 0,
  supportZoneHeight: 0,
  resistanceZonePosition: 0,
  supportZonePosition: 0,
  donchianBreakout: { upper: false, lower: false },
  bollingerPosition: { aboveUpper: false, belowLower: false },
  stochasticPosition: {
    overbought: false,
    oversold: false,
    kValue: 0,
    dValue: 0,
  },
  consecutiveCandles: 0,
  rsiValue: 0,
  aboveUpperBB: false,
  belowLowerBB: false,
  candleAnalysis: defaultEmptyCandleMetrics,
  candleSizeValidation: {
    isValid: false,
    averageRange: 0,
    checkedCandles: 0,
    minRequiredSize: 0,
  },
});

/**
 * Calculate candle metrics (body, wicks, ratios)
 */
function calculateCandleMetrics(candle: Candle) {
  const totalRange = candle.max - candle.min;
  const bodySize = Math.abs(candle.close - candle.open);
  const bodyRatio = totalRange > 0 ? bodySize / totalRange : 0;

  const upperWick = candle.max - Math.max(candle.open, candle.close);
  const upperWickRatio = totalRange > 0 ? upperWick / totalRange : 0;

  const lowerWick = Math.min(candle.open, candle.close) - candle.min;
  const lowerWickRatio = totalRange > 0 ? lowerWick / totalRange : 0;

  return {
    bodySize,
    bodyRatio,
    upperWick,
    upperWickRatio,
    lowerWick,
    lowerWickRatio,
    hasValidBody: bodyRatio >= MIN_BODY_RATIO,
    hasSmallUpperWick: upperWickRatio < MAX_REJECTION_WICK_RATIO,
    hasSmallLowerWick: lowerWickRatio < MAX_REJECTION_WICK_RATIO,
  };
}

/**
 * Analyze multiple candles using Option D pattern:
 * - All candles should have valid bodies
 * - Current candle should have the smallest rejection wick (strongest signal)
 */
function analyzeMultipleCandlesPattern(
  candles: Candle[],
  signalType: "PUT" | "CALL"
): {
  allCandlesHaveValidBodies: boolean;
  currentCandleHasSmallestRejectionWick: boolean;
} {
  const candlesToCheck = candles.slice(
    -NUMBER_OF_CANDLES_TO_CHECK_BODY_AND_WICKS
  );

  if (candlesToCheck.length < NUMBER_OF_CANDLES_TO_CHECK_BODY_AND_WICKS) {
    return {
      allCandlesHaveValidBodies: false,
      currentCandleHasSmallestRejectionWick: false,
    };
  }

  const allMetrics = candlesToCheck.map(calculateCandleMetrics);
  const allCandlesHaveValidBodies = allMetrics.every(
    (metrics) => metrics.hasValidBody
  );

  const currentCandleMetrics = allMetrics[allMetrics.length - 1];
  const previousCandlesMetrics = allMetrics.slice(0, -1);

  if (signalType === "PUT") {
    const currentUpperWickRatio = currentCandleMetrics.upperWickRatio;
    const currentCandleHasSmallestRejectionWick = previousCandlesMetrics.every(
      (m) => currentUpperWickRatio <= m.upperWickRatio
    );
    return {
      allCandlesHaveValidBodies,
      currentCandleHasSmallestRejectionWick,
    };
  } else {
    // CALL signal
    const currentLowerWickRatio = currentCandleMetrics.lowerWickRatio;
    const currentCandleHasSmallestRejectionWick = previousCandlesMetrics.every(
      (m) => currentLowerWickRatio <= m.lowerWickRatio
    );
    return {
      allCandlesHaveValidBodies,
      currentCandleHasSmallestRejectionWick,
    };
  }
}

/**
 * Validate that the last N candles meet minimum size requirements
 */
function validateCandleSizes(
  candles: Candle[],
  numberToCheck: number,
  minLookbackPeriod: number,
  lookbackPercentage: number,
  minRatio: number
): {
  isValid: boolean;
  averageRange: number;
  checkedCandles: number;
  minRequiredSize: number;
} {
  const calculatedLookback = Math.floor(candles.length * lookbackPercentage);
  const lookbackPeriod = Math.max(minLookbackPeriod, calculatedLookback);

  if (candles.length < lookbackPeriod + numberToCheck) {
    return {
      isValid: false,
      averageRange: 0,
      checkedCandles: 0,
      minRequiredSize: 0,
    };
  }

  if (candles.length < numberToCheck) {
    return {
      isValid: false,
      averageRange: 0,
      checkedCandles: candles.length,
      minRequiredSize: 0,
    };
  }

  // Exclude the last numberToCheck candles from average to avoid circular reference
  const lookbackCandles = candles.slice(
    -(lookbackPeriod + numberToCheck),
    -numberToCheck
  );
  const totalBodySize = lookbackCandles.reduce(
    (sum, candle) => sum + Math.abs(candle.close - candle.open),
    0
  );
  const averageBodySize = totalBodySize / lookbackPeriod;

  if (averageBodySize <= 0) {
    return {
      isValid: false,
      averageRange: 0,
      checkedCandles: numberToCheck,
      minRequiredSize: 0,
    };
  }

  const minRequiredSize = averageBodySize * minRatio;
  const candlesToCheck = candles.slice(-numberToCheck);
  const allCandlesValid = candlesToCheck.every((candle) => {
    const candleBodySize = Math.abs(candle.close - candle.open);
    return candleBodySize >= minRequiredSize;
  });

  return {
    isValid: allCandlesValid,
    averageRange: averageBodySize,
    checkedCandles: numberToCheck,
    minRequiredSize,
  };
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Calculate trading signal based on multiple technical indicators
 * Implements reversal trading strategy with multiple confirmations
 * @param candles Array of candlestick data (minimum 20, recommended 100)
 * @param config Configuration for indicators
 * @returns Signal result with type and details
 */
export function calculateSignalWithCandle(
  candles: Candle[],
  config: SignalCalculationConfig = {}
): SignalResult {
  const {
    supportResistancePeriod = 25,
    donchianPeriod = 20,
    bollingerPeriod = 14,
    bollingerStdDev = 2,
    stochasticKPeriod = 13,
    stochasticDPeriod = 3,
    stochasticSmoothing = 3,
    stochasticKOverboughtThreshold = STOCHASTIC_K_OVERBOUGHT_THRESHOLD,
    stochasticKOversoldThreshold = STOCHASTIC_K_OVERSOLD_THRESHOLD,
    stochasticDOverboughtThreshold = STOCHASTIC_D_OVERBOUGHT_THRESHOLD,
    stochasticDOversoldThreshold = STOCHASTIC_D_OVERSOLD_THRESHOLD,
    rsiPeriod = 14,
    minCandles = 20,
    minCandlesToCheckSize = NUMBER_OF_CANDLES_TO_CHECK_MIN_SIZE,
    minCandleSizeLookbackPeriod = MIN_CANDLE_SIZE_LOOKBACK_PERIOD,
    lookbackPercentage = LOOKBACK_PERCENTAGE,
    minCandleSizeRatio = MIN_CANDLE_SIZE_RATIO,
    zonePositionThreshold = ZONE_POSITION_THRESHOLD,
  } = config;

  // Early return if not enough candles
  if (candles.length < minCandles) {
    console.log("Not enough candles to calculate signal");
    return {
      signal: SignalType.HOLD,
      details: defaultEmptyDetails(),
    };
  }

  // Calculate all indicators
  const supportResistanceData = calculateSupportResistance(candles, {
    boxPeriod: supportResistancePeriod,
  });
  const donchianData = calculateDonchianForCandles(candles, {
    period: donchianPeriod,
  });
  const bollingerData = calculateBollingerBandsForCandles(candles, {
    period: bollingerPeriod,
    stdDev: bollingerStdDev,
  });
  const stochasticData = calculateStochasticForCandles(candles, {
    kPeriod: stochasticKPeriod,
    dPeriod: stochasticDPeriod,
    smoothing: stochasticSmoothing,
  });
  const rsiData = calculateRSIForCandles(candles, { period: rsiPeriod });
  const consecutiveData = calculateConsecutiveCandleColors(candles);

  // Get the last values (most recent candle)
  const lastCandle = candles[candles.length - 1];
  const lastSR = supportResistanceData[supportResistanceData.length - 1];
  const lastDonchian = donchianData[donchianData.length - 1];
  const lastBollinger = bollingerData[bollingerData.length - 1];
  const lastStochastic = stochasticData[stochasticData.length - 1];
  const lastRSI = rsiData[rsiData.length - 1];
  const lastConsecutive = consecutiveData[consecutiveData.length - 1];

  // Validate all indicator data exists
  if (
    !lastSR ||
    !lastDonchian ||
    !lastBollinger ||
    !lastStochastic ||
    !lastRSI ||
    !lastConsecutive ||
    lastSR.resistance === null ||
    lastSR.support === null
  ) {
    return {
      signal: SignalType.HOLD,
      details: defaultEmptyDetails(),
    };
  }

  // Calculate support/resistance zones
  const midSR = (lastSR.resistance + lastSR.support) / 2;
  const upperZoneHeight = lastSR.resistance - midSR;
  const lowerZoneHeight = midSR - lastSR.support;

  const isNearResistance =
    upperZoneHeight > 0 &&
    (lastCandle.max - midSR) / upperZoneHeight >= zonePositionThreshold;
  const isNearSupport =
    lowerZoneHeight > 0 &&
    (midSR - lastCandle.min) / lowerZoneHeight >= zonePositionThreshold;

  // Get previous Donchian values for breakout detection
  const prevDonchian = donchianData[donchianData.length - 2];
  const prevUpperDC = prevDonchian?.upper;
  const prevLowerDC = prevDonchian?.lower;

  // Check Donchian breakouts
  const donchianUpperBreakout =
    prevUpperDC !== undefined && lastCandle.max > prevUpperDC;
  const donchianLowerBreakout =
    prevLowerDC !== undefined && lastCandle.min < prevLowerDC;

  // Check Bollinger Bands position
  const aboveUpperBB = lastCandle.max > lastBollinger.upper;
  const belowLowerBB = lastCandle.min < lastBollinger.lower;

  // Check Stochastic position (both K and D must confirm)
  const stochasticOverbought =
    lastStochastic.k > stochasticKOverboughtThreshold &&
    lastStochastic.d > stochasticDOverboughtThreshold;
  const stochasticOversold =
    lastStochastic.k < stochasticKOversoldThreshold &&
    lastStochastic.d < stochasticDOversoldThreshold;

  // Check consecutive candles
  const consecutiveCandles = lastConsecutive.consecutiveColors;

  // Calculate candle metrics and patterns
  const candleMetrics = calculateCandleMetrics(lastCandle);
  const putMultiCandlePattern = analyzeMultipleCandlesPattern(candles, "PUT");
  const callMultiCandlePattern = analyzeMultipleCandlesPattern(candles, "CALL");
  const candleSizeValidation = validateCandleSizes(
    candles,
    minCandlesToCheckSize,
    minCandleSizeLookbackPeriod,
    lookbackPercentage,
    minCandleSizeRatio
  );

  // PUT Signal Conditions (Resistance Zone) - ALL must be true
  const putConditionsMet =
    isNearResistance &&
    prevUpperDC !== undefined &&
    donchianUpperBreakout &&
    aboveUpperBB &&
    stochasticOverbought &&
    consecutiveCandles >= NUMBER_OF_CONSECUTIVE_CANDLES &&
    candleMetrics.hasValidBody &&
    candleMetrics.hasSmallUpperWick &&
    putMultiCandlePattern.allCandlesHaveValidBodies &&
    putMultiCandlePattern.currentCandleHasSmallestRejectionWick &&
    candleSizeValidation.isValid;

  // CALL Signal Conditions (Support Zone) - ALL must be true
  const callConditionsMet =
    isNearSupport &&
    prevLowerDC !== undefined &&
    donchianLowerBreakout &&
    belowLowerBB &&
    stochasticOversold &&
    consecutiveCandles <= -NUMBER_OF_CONSECUTIVE_CANDLES &&
    candleMetrics.hasValidBody &&
    candleMetrics.hasSmallLowerWick &&
    callMultiCandlePattern.allCandlesHaveValidBodies &&
    callMultiCandlePattern.currentCandleHasSmallestRejectionWick &&
    candleSizeValidation.isValid;

  // Determine signal
  const signal = putConditionsMet
    ? SignalType.PUT
    : callConditionsMet
    ? SignalType.CALL
    : SignalType.HOLD;

  return {
    signal,
    details: {
      isNearResistance,
      isNearSupport,
      resistanceZoneHeight: upperZoneHeight,
      supportZoneHeight: lowerZoneHeight,
      resistanceZonePosition:
        upperZoneHeight > 0 ? (lastCandle.max - midSR) / upperZoneHeight : 0,
      supportZonePosition:
        lowerZoneHeight > 0 ? (midSR - lastCandle.min) / lowerZoneHeight : 0,
      donchianBreakout: {
        upper: donchianUpperBreakout,
        lower: donchianLowerBreakout,
      },
      bollingerPosition: {
        aboveUpper: aboveUpperBB,
        belowLower: belowLowerBB,
      },
      stochasticPosition: {
        overbought: stochasticOverbought,
        oversold: stochasticOversold,
        kValue: lastStochastic.k,
        dValue: lastStochastic.d,
      },
      consecutiveCandles,
      rsiValue: lastRSI.rsi, // Kept for backward compatibility
      aboveUpperBB,
      belowLowerBB,
      candleAnalysis: candleMetrics,
      candleSizeValidation,
    },
  };
}

/**
 * Calculate signal with default configuration matching Python script
 */
export function calculateSignalWithCandleDefaults(
  candles: Candle[]
): SignalResult {
  return calculateSignalWithCandle(candles, {
    supportResistancePeriod: 25,
    donchianPeriod: 20,
    bollingerPeriod: 14,
    bollingerStdDev: 2,
    stochasticKPeriod: 13,
    stochasticDPeriod: 3,
    stochasticSmoothing: 3,
    rsiPeriod: 14,
    minCandles: 20,
  });
}

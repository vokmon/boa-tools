// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import { SignalType } from "../types/signal/Signal";
import { calculateSupportResistance } from "../indicators/supportResistance";
import { calculateDonchianForCandles } from "../indicators/donchian";
import { calculateBollingerBandsForCandles } from "../indicators/bollingerBands";
import { calculateStochasticForCandles } from "../indicators/stochastic";
import { calculateRSIForCandles } from "../indicators/rsi";
import { calculateConsecutiveCandleColors } from "../indicators/consecutiveCandleColors";
import { Candle } from "@quadcode-tech/client-sdk-js";
import {
  DEFAULT_SIGNAL_SETTINGS,
  SIGNAL_SETTINGS,
  type SignalSettings,
} from "./config/signalSettings";

export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
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
    };
    consecutiveCandles: number;
    rsiValue: number;
    aboveUpperBB: boolean;
    belowLowerBB: boolean;
  };
}

/**
 * Calculate trading signal based on multiple technical indicators
 * Implements the exact logic from the Python signal-generator.py script
 * @param candles Array of candlestick data (minimum 20, recommended 100)
 * @param settings Signal settings, from src/utils/indicators/config/signal-settings.json by default
 * @returns Signal result with type and confidence
 */
export function calculateSignalWithCandle(
  candles: Candle[],
  settings: SignalSettings = SIGNAL_SETTINGS
): SignalResult {
  // Check minimum data requirement
  if (candles.length < settings.window.minCandles) {
    console.log("Not enough candles to calculate signal");
    return {
      signal: SignalType.HOLD,
      details: {
        isNearResistance: false,
        isNearSupport: false,
        resistanceZoneHeight: 0,
        supportZoneHeight: 0,
        resistanceZonePosition: 0,
        supportZonePosition: 0,
        donchianBreakout: { upper: false, lower: false },
        bollingerPosition: { aboveUpper: false, belowLower: false },
        stochasticPosition: { overbought: false, oversold: false, kValue: 0 },
        consecutiveCandles: 0,
        rsiValue: 0,
        aboveUpperBB: false,
        belowLowerBB: false,
      },
    };
  }

  // Calculate all indicators
  const supportResistanceData = calculateSupportResistance(candles, {
    boxPeriod: settings.supportResistance.period,
  });

  const donchianData = calculateDonchianForCandles(candles, {
    period: settings.donchian.period,
  });

  const bollingerData = calculateBollingerBandsForCandles(candles, {
    period: settings.bollinger.period,
    stdDev: settings.bollinger.stdDev,
  });

  const stochasticData = calculateStochasticForCandles(candles, {
    kPeriod: settings.stochastic.k,
    dPeriod: settings.stochastic.d,
    smoothing: settings.stochastic.smooth,
  });

  const rsiData = calculateRSIForCandles(candles, {
    period: settings.rsi.period,
  });

  const consecutiveData = calculateConsecutiveCandleColors(candles);

  // Get the last values (most recent candle)
  const lastCandle = candles[candles.length - 1];
  const lastSR = supportResistanceData[supportResistanceData.length - 1];
  const lastDonchian = donchianData[donchianData.length - 1];
  const lastBollinger = bollingerData[bollingerData.length - 1];
  const lastStochastic = stochasticData[stochasticData.length - 1];
  const lastRSI = rsiData[rsiData.length - 1];
  const lastConsecutive = consecutiveData[consecutiveData.length - 1];

  // Check if we have valid data. A switched-off rule does not need its
  // indicator to have a value.
  const hasSupportResistance =
    !!lastSR && lastSR.resistance !== null && lastSR.support !== null;
  if (
    (settings.supportResistance.use && !hasSupportResistance) ||
    (settings.donchian.use && !lastDonchian) ||
    (settings.bollinger.use && !lastBollinger) ||
    (settings.stochastic.use && !lastStochastic) ||
    !lastRSI ||
    !lastConsecutive
  ) {
    return {
      signal: SignalType.HOLD,
      details: {
        isNearResistance: false,
        isNearSupport: false,
        resistanceZoneHeight: 0,
        supportZoneHeight: 0,
        resistanceZonePosition: 0,
        supportZonePosition: 0,
        donchianBreakout: { upper: false, lower: false },
        bollingerPosition: { aboveUpper: false, belowLower: false },
        stochasticPosition: { overbought: false, oversold: false, kValue: 0 },
        consecutiveCandles: 0,
        rsiValue: 0,
        aboveUpperBB: false,
        belowLowerBB: false,
      },
    };
  }

  // Calculate support/resistance zones
  let upperZoneHeight = 0;
  let lowerZoneHeight = 0;
  let isNearResistance = false;
  let isNearSupport = false;
  let resistanceZonePosition = 0;
  let supportZonePosition = 0;
  if (hasSupportResistance) {
    const midSR = (lastSR.resistance! + lastSR.support!) / 2;
    upperZoneHeight = lastSR.resistance! - midSR;
    lowerZoneHeight = midSR - lastSR.support!;
    resistanceZonePosition =
      upperZoneHeight > 0 ? (lastCandle.max - midSR) / upperZoneHeight : 0;
    supportZonePosition =
      lowerZoneHeight > 0 ? (midSR - lastCandle.min) / lowerZoneHeight : 0;
    isNearResistance =
      upperZoneHeight > 0 &&
      resistanceZonePosition >= settings.supportResistance.zone;
    isNearSupport =
      lowerZoneHeight > 0 &&
      supportZonePosition >= settings.supportResistance.zone;
  }

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
  const aboveUpperBB = !!lastBollinger && lastCandle.max > lastBollinger.upper;
  const belowLowerBB = !!lastBollinger && lastCandle.min < lastBollinger.lower;

  // Check Stochastic position
  const stochasticOverbought =
    !!lastStochastic && lastStochastic.k > settings.stochastic.kOverbought;
  const stochasticOversold =
    !!lastStochastic && lastStochastic.k < settings.stochastic.kOversold;

  // Check consecutive candles
  const consecutiveCandles = lastConsecutive.consecutiveColors;

  // Check the last candle's shape: a solid body and a short wick on the
  // reversal side (upper for PUT, lower for CALL), as a share of its range
  const range = lastCandle.max - lastCandle.min;
  const bodyRatio =
    range > 0 ? Math.abs(lastCandle.close - lastCandle.open) / range : 0;
  const upperWickRatio =
    range > 0
      ? (lastCandle.max - Math.max(lastCandle.open, lastCandle.close)) / range
      : 0;
  const lowerWickRatio =
    range > 0
      ? (Math.min(lastCandle.open, lastCandle.close) - lastCandle.min) / range
      : 0;
  const hasSolidBody = bodyRatio >= settings.candle.minBody;
  const putCandleShape =
    !settings.candle.useShape ||
    (hasSolidBody && upperWickRatio < settings.candle.maxWick);
  const callCandleShape =
    !settings.candle.useShape ||
    (hasSolidBody && lowerWickRatio < settings.candle.maxWick);

  // SELL Signal Conditions (Resistance Zone) - ALL must be true
  const putConditionsMet =
    (!settings.supportResistance.use || isNearResistance) &&
    (!settings.donchian.use ||
      (prevUpperDC !== undefined && donchianUpperBreakout)) &&
    (!settings.bollinger.use || aboveUpperBB) &&
    (!settings.stochastic.use || stochasticOverbought) &&
    consecutiveCandles >= settings.candle.sameColourInARow &&
    putCandleShape;

  // BUY Signal Conditions (Support Zone) - ALL must be true
  const callConditionsMet =
    (!settings.supportResistance.use || isNearSupport) &&
    (!settings.donchian.use ||
      (prevLowerDC !== undefined && donchianLowerBreakout)) &&
    (!settings.bollinger.use || belowLowerBB) &&
    (!settings.stochastic.use || stochasticOversold) &&
    consecutiveCandles <= -settings.candle.sameColourInARow &&
    callCandleShape;

  // Determine signal - binary logic matching Python script
  let signal: SignalType;
  if (putConditionsMet) {
    signal = SignalType.PUT;
  } else if (callConditionsMet) {
    signal = SignalType.CALL;
  } else {
    signal = SignalType.HOLD;
  }

  return {
    signal,
    details: {
      isNearResistance,
      isNearSupport,
      resistanceZoneHeight: upperZoneHeight,
      supportZoneHeight: lowerZoneHeight,
      resistanceZonePosition,
      supportZonePosition,
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
        kValue: lastStochastic?.k ?? 0,
      },
      consecutiveCandles,
      rsiValue: lastRSI.rsi,
      aboveUpperBB,
      belowLowerBB,
    },
  };
}

/**
 * Calculate signal with the default settings
 * @param candles Array of candlestick data (minimum 20, recommended 100)
 * @returns Signal result
 */
export function calculateSignalWithCandleDefaults(candles: Candle[]): SignalResult {
  return calculateSignalWithCandle(candles, DEFAULT_SIGNAL_SETTINGS);
}

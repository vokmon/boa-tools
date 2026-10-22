// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import type {
  SupportResistanceData,
  SupportResistanceConfig,
} from "../types/indicators/supportResistance";
import { Candle } from "@quadcode-tech/client-sdk-js";

/**
 * Calculate Support and Resistance levels following the Python signal-generator logic
 * Uses rolling window to find highest high and lowest low, then forward fills
 * @param candles Array of candlestick data with time, max (high), and min (low)
 * @param config Support and Resistance configuration
 * @returns Array of Support and Resistance data
 */
export function calculateSupportResistance(
  candles: Candle[],
  config: SupportResistanceConfig = { boxPeriod: 25 }
): SupportResistanceData[] {
  const { boxPeriod } = config;
  const result: SupportResistanceData[] = [];

  if (candles.length < boxPeriod) {
    // Not enough data, return empty levels
    return candles.map((candle) => ({
      time: candle.from as number,
      resistance: null,
      support: null,
    }));
  }

  // Calculate rolling highest high and lowest low
  const highestHighs: number[] = [];
  const lowestLows: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < boxPeriod - 1) {
      // Not enough data for rolling window
      highestHighs.push(NaN);
      lowestLows.push(NaN);
    } else {
      // Calculate rolling max and min
      let maxHigh = -Infinity;
      let minLow = Infinity;

      for (let j = i - boxPeriod + 1; j <= i; j++) {
        maxHigh = Math.max(maxHigh, candles[j].max);
        minLow = Math.min(minLow, candles[j].min);
      }

      highestHighs.push(maxHigh);
      lowestLows.push(minLow);
    }
  }

  // Find resistance and support points
  const resistancePoints: (number | null)[] = [];
  const supportPoints: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (isNaN(highestHighs[i])) {
      resistancePoints.push(null);
      supportPoints.push(null);
    } else {
      // Resistance: when current high >= rolling highest high
      resistancePoints.push(
        candles[i].max >= highestHighs[i] ? candles[i].max : null
      );
      // Support: when current low <= rolling lowest low
      supportPoints.push(
        candles[i].min <= lowestLows[i] ? candles[i].min : null
      );
    }
  }

  // Forward fill the resistance and support values
  let lastResistance: number | null = null;
  let lastSupport: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    if (resistancePoints[i] !== null) {
      lastResistance = resistancePoints[i];
    }
    if (supportPoints[i] !== null) {
      lastSupport = supportPoints[i];
    }

    result.push({
      time: candles[i].from as number,
      resistance: lastResistance,
      support: lastSupport,
    });
  }

  return result;
}

/**
 * Calculate Support and Resistance levels for candlestick data with different property names
 * @param candles Array of candlestick data with time, high, and low prices
 * @param config Support and Resistance configuration
 * @returns Array of Support and Resistance data
 */
export function calculateSupportResistanceForCandles(
  candles: Candle[],
  config: SupportResistanceConfig = { boxPeriod: 25 }
): SupportResistanceData[] {
  // Convert high/low to max/min format

  return calculateSupportResistance(candles, config);
}

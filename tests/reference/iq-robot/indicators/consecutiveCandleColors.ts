// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import type { ConsecutiveCandleColorsData } from "../types/indicators/consecutiveCandleColors";
import { Candle } from "@quadcode-tech/client-sdk-js";

/**
 * Calculate consecutive candle colors for a series of candlestick data
 * @param candles Array of candlestick data with time, open, and close prices
 * @returns Array of consecutive candle colors data
 */
export function calculateConsecutiveCandleColors(
  candles: Candle[]
): ConsecutiveCandleColorsData[] {
  const result: ConsecutiveCandleColorsData[] = [];
  const consecutiveCounts: number[] = [];
  let currentCount = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const isGreen = candle.close > candle.open;
    const isRed = candle.close < candle.open;
    const isDoji = candle.close === candle.open;

    if (i > 0 && !isDoji) {
      const prevCandle = candles[i - 1];
      const prevIsGreen = prevCandle.close > prevCandle.open;
      const prevIsRed = prevCandle.close < prevCandle.open;
      const prevIsDoji = prevCandle.close === prevCandle.open;

      // If current candle color matches previous candle color and neither is doji
      if (((isGreen && prevIsGreen) || (isRed && prevIsRed)) && !prevIsDoji) {
        if (isGreen) {
          currentCount = Math.abs(currentCount) + 1;
        } else {
          currentCount = -(Math.abs(currentCount) + 1);
        }
      } else {
        // Reset or start new sequence
        if (isGreen) {
          currentCount = 1;
        } else if (isRed) {
          currentCount = -1;
        } else {
          currentCount = 0;
        }
      }
    } else {
      // First candle or doji
      if (isGreen) {
        currentCount = 1;
      } else if (isRed) {
        currentCount = -1;
      } else {
        currentCount = 0;
      }
    }

    consecutiveCounts.push(currentCount);
  }

  // Convert to result format
  for (let i = 0; i < candles.length; i++) {
    result.push({
      time: candles[i].from as number,
      consecutiveColors: consecutiveCounts[i],
    });
  }

  return result;
}

/**
 * Calculate consecutive candle colors for candlestick data
 * @param candles Array of candlestick data with time, open, and close prices
 * @returns Array of consecutive candle colors data with time
 */
export function calculateConsecutiveCandleColorsForCandles(
  candles: Candle[]
): ConsecutiveCandleColorsData[] {
  return calculateConsecutiveCandleColors(candles);
}

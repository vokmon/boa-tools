// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import type {
  StochasticData,
  StochasticConfig,
} from "../types/indicators/stochastic";
import { Candle } from "@quadcode-tech/client-sdk-js";

/**
 * Calculate Stochastic Oscillator for a series of price data
 * @param prices Array of price data with high, low, close
 * @param config Stochastic configuration
 * @returns Array of Stochastic data
 */
export function calculateStochastic(
  prices: Array<{ high: number; low: number; close: number }>,
  config: StochasticConfig = { kPeriod: 13, dPeriod: 3, smoothing: 3 }
): StochasticData[] {
  const { kPeriod, dPeriod, smoothing } = config;
  const result: StochasticData[] = [];

  // Calculate %K values
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < prices.length; i++) {
    const slice = prices.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map((p) => p.high));
    const lowestLow = Math.min(...slice.map((p) => p.low));
    const currentClose = prices[i].close;

    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    kValues.push(k);
  }

  // Apply smoothing to %K if needed
  const smoothedKValues: number[] = [];
  if (smoothing > 1) {
    for (let i = 0; i < kValues.length; i++) {
      const start = Math.max(0, i - smoothing + 1);
      const slice = kValues.slice(start, i + 1);
      const smoothed = slice.reduce((sum, val) => sum + val, 0) / slice.length;
      smoothedKValues.push(smoothed);
    }
  } else {
    smoothedKValues.push(...kValues);
  }

  // Calculate %D values (moving average of %K)
  for (let i = dPeriod - 1; i < smoothedKValues.length; i++) {
    const slice = smoothedKValues.slice(i - dPeriod + 1, i + 1);
    const d = slice.reduce((sum, val) => sum + val, 0) / dPeriod;

    result.push({
      time: i + kPeriod - 1, // Adjust time index
      k: smoothedKValues[i],
      d: d,
    });
  }

  return result;
}

/**
 * Calculate Stochastic Oscillator for candlestick data
 * @param candles Array of candlestick data with time, high, low, close
 * @param config Stochastic configuration
 * @returns Array of Stochastic data with time
 */
export function calculateStochasticForCandles(
  candles: Candle[],
  config: StochasticConfig = { kPeriod: 13, dPeriod: 3, smoothing: 3 }
): StochasticData[] {
  const prices = candles.map((candle) => ({
    high: candle.max,
    low: candle.min,
    close: candle.close,
  }));

  const stochasticData = calculateStochastic(prices, config);

  // Map the time from the original candles
  return stochasticData.map((data, index) => ({
    ...data,
    time:
      (candles[index + config.kPeriod + config.dPeriod - 2]?.from as number) ||
      0,
  }));
}

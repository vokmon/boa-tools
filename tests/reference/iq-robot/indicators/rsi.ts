// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import type { RSIData, RSIConfig } from "../types/indicators/rsi";
import { Candle } from "@quadcode-tech/client-sdk-js";

/**
 * Calculate Exponential Moving Average (EMA)
 * @param values Array of values
 * @param period Period for EMA calculation
 * @returns Array of EMA values
 */
function calculateEMA(values: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const ema: number[] = [];

  // Initialize with the first value
  ema[0] = values[0];

  // Calculate EMA for remaining values
  for (let i = 1; i < values.length; i++) {
    ema[i] = alpha * values[i] + (1 - alpha) * ema[i - 1];
  }

  return ema;
}

/**
 * Calculate Relative Strength Index (RSI) for a series of closing prices
 * @param prices Array of closing prices
 * @param config RSI configuration
 * @returns Array of RSI data
 */
export function calculateRSI(
  prices: number[],
  config: RSIConfig = { period: 14 }
): RSIData[] {
  const { period } = config;
  const result: RSIData[] = [];

  if (prices.length < period + 1) {
    return result;
  }

  // Calculate price changes
  const deltas: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    deltas.push(prices[i] - prices[i - 1]);
  }

  // Separate gains and losses
  const gains: number[] = deltas.map((delta) => (delta > 0 ? delta : 0));
  const losses: number[] = deltas.map((delta) =>
    delta < 0 ? Math.abs(delta) : 0
  );

  // Calculate EMA for gains and losses
  const avgGains = calculateEMA(gains, period);
  const avgLosses = calculateEMA(losses, period);

  // Calculate RSI values
  for (let i = period - 1; i < deltas.length; i++) {
    const avgGain = avgGains[i];
    const avgLoss = avgLosses[i];

    // Avoid division by zero
    if (avgLoss === 0) {
      result.push({
        time: i + 1, // +1 because we started from index 1 for deltas
        rsi: 100,
      });
    } else {
      const rs = avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);

      result.push({
        time: i + 1,
        rsi: rsi,
      });
    }
  }

  return result;
}

/**
 * Calculate RSI for candlestick data
 * @param candles Array of candlestick data with time and close price
 * @param config RSI configuration
 * @returns Array of RSI data with time
 */
export function calculateRSIForCandles(
  candles: Candle[],
  config: RSIConfig = { period: 14 }
): RSIData[] {
  const prices = candles.map((candle) => candle.close);
  const rsiData = calculateRSI(prices, config);

  // Map the time from the original candles
  return rsiData.map((data, index) => ({
    ...data,
    time: (candles[index + config.period]?.from as number) || 0,
  }));
}

// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import type {
  BollingerBandsData,
  BollingerBandsConfig,
} from "../types/indicators/bollingerBands";
import { Candle } from "@quadcode-tech/client-sdk-js";

/**
 * Calculate Bollinger Bands for a series of price data
 * @param prices Array of closing prices
 * @param config Bollinger Bands configuration
 * @returns Array of Bollinger Bands data
 */
export function calculateBollingerBands(
  prices: number[],
  config: BollingerBandsConfig = { period: 20, stdDev: 2 }
): BollingerBandsData[] {
  const { period, stdDev } = config;
  const result: BollingerBandsData[] = [];

  for (let i = period - 1; i < prices.length; i++) {
    // Get the slice of prices for the current period
    const slice = prices.slice(i - period + 1, i + 1);

    // Calculate Simple Moving Average (middle line)
    const sma = slice.reduce((sum, price) => sum + price, 0) / period;

    // Calculate standard deviation
    const variance =
      slice.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    // Calculate upper and lower bands
    const upper = sma + standardDeviation * stdDev;
    const lower = sma - standardDeviation * stdDev;

    result.push({
      time: i,
      middle: sma,
      upper: upper,
      lower: lower,
    });
  }

  return result;
}

/**
 * Calculate Bollinger Bands for candlestick data
 * @param candles Array of candlestick data with time and close price
 * @param config Bollinger Bands configuration
 * @returns Array of Bollinger Bands data with time
 */
export function calculateBollingerBandsForCandles(
  candles: Candle[],
  config: BollingerBandsConfig = { period: 20, stdDev: 2 }
): BollingerBandsData[] {
  const prices = candles.map((candle) => candle.close);
  const bollingerData = calculateBollingerBands(prices, config);

  // Map the time from the original candles
  return bollingerData.map((data, index) => ({
    ...data,
    time: candles[index + config.period - 1]?.from || 0,
  }));
}

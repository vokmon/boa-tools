// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import type { DonchianData, DonchianConfig } from "../types/indicators/donchian";
import { Candle } from "@quadcode-tech/client-sdk-js";

/**
 * Calculate Donchian Channels for a series of price data
 * @param highPrices Array of high prices
 * @param lowPrices Array of low prices
 * @param config Donchian configuration
 * @returns Array of Donchian data
 */
export function calculateDonchian(
  highPrices: number[],
  lowPrices: number[],
  config: DonchianConfig = { period: 20 }
): DonchianData[] {
  const { period } = config;
  const result: DonchianData[] = [];

  for (let i = period - 1; i < highPrices.length; i++) {
    // Get the slice of high and low prices for the current period
    const highSlice = highPrices.slice(i - period + 1, i + 1);
    const lowSlice = lowPrices.slice(i - period + 1, i + 1);

    // Calculate highest high and lowest low
    const upper = Math.max(...highSlice);
    const lower = Math.min(...lowSlice);
    const middle = (upper + lower) / 2;

    result.push({
      time: i,
      upper: upper,
      lower: lower,
      middle: middle,
    });
  }

  return result;
}

/**
 * Calculate Donchian Channels for candlestick data
 * @param candles Array of candlestick data with time, high, and low prices
 * @param config Donchian configuration
 * @returns Array of Donchian data with time
 */
export function calculateDonchianForCandles(
  candles: Candle[],
  config: DonchianConfig = { period: 20 }
): DonchianData[] {
  const highPrices = candles.map((candle) => candle.max);
  const lowPrices = candles.map((candle) => candle.min);
  const donchianData = calculateDonchian(highPrices, lowPrices, config);

  // Map the time from the original candles
  return donchianData.map((data, index) => ({
    ...data,
    time:
      (candles[index + config.period - 1]?.from as number) ||
      (candles[candles.length - 1]?.from as number) ||
      0,
  }));
}

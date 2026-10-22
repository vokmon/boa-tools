// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
export interface BollingerBandsData {
  time: number;
  middle: number;
  upper: number;
  lower: number;
}

export interface BollingerBandsConfig {
  period: number; // Default: 20
  stdDev: number; // Default: 2
}

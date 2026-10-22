// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
export interface DonchianData {
  time: number;
  upper: number;
  lower: number;
  middle: number;
}

export interface DonchianConfig {
  period: number; // Default: 20
}

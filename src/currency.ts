import { utils } from '@actual-app/api';

/**
 * Converts a human-readable Decimal Amount (e.g. -12.34) at the MCP boundary
 * into an integer Minor Unit Amount (e.g. -1234) used by @actual-app/api.
 */
export function decimalToMinorAmount(decimalAmount: number): number {
  const result = utils.amountToInteger(decimalAmount);
  return Object.is(result, -0) ? 0 : result;
}

/**
 * Converts an integer Minor Unit Amount (e.g. -1234) from @actual-app/api
 * into a human-readable Decimal Amount (e.g. -12.34) for the MCP boundary.
 */
export function minorToDecimalAmount(minorAmount: number): number {
  const result = utils.integerToAmount(minorAmount);
  return Object.is(result, -0) ? 0 : result;
}

export const toMinorUnits = decimalToMinorAmount;
export const toDecimalUnits = minorToDecimalAmount;


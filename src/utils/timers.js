// Basic timer helpers kept isolated so tests can mock them easily.
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

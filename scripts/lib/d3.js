/**
 * D3 re-export wrapper.
 *
 * index.html loads vendor/d3.v7.min.js as a regular <script>, which sets
 * window.d3.  This module re-exports it so that other ES modules can write:
 *
 *   import d3 from '../lib/d3.js';
 *
 * Individual named exports can be added below as more of D3's API is used,
 * keeping imports in consuming files clean.
 */
const d3 = window.d3;

if (!d3) {
  throw new Error(
    '[d3.js] window.d3 is not defined. ' +
    'Make sure vendor/d3.v7.min.js is loaded before the ES module entry point.'
  );
}

export default d3;

export const {
  select,
  selectAll,
  scaleLinear,
  arc,
  line,
  path,
  transition,
  interpolate,
  interpolateRgb,
  easeLinear,
  easeCubicInOut,
  easeQuadInOut,
  timer,
  now,
  drag,
  pointer,
} = d3;

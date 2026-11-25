import { describe, expect, it } from 'vitest';
import {
  createFullViewport,
  ensureRangeVisible,
  getMaxZoom,
  panViewport,
  secToViewportPct,
  viewportRatioToSec,
  zoomAroundAnchor,
} from '../timelineZoom';

describe('getMaxZoom', () => {
  it('caps zoom at 40x and keeps at least a 2-second window', () => {
    expect(getMaxZoom(0)).toBe(1);
    expect(getMaxZoom(1.5)).toBe(1);
    expect(getMaxZoom(20)).toBe(10);
    expect(getMaxZoom(180)).toBe(40);
  });
});

describe('zoomAroundAnchor', () => {
  it('keeps the time under the cursor anchored when zooming in and out', () => {
    const duration = 120;
    const full = createFullViewport(duration);
    const cursorRatio = 0.25; // 30s at 1x

    const zoomedIn = zoomAroundAnchor(full, duration, cursorRatio, 2);
    expect(zoomedIn.zoom).toBeCloseTo(2, 5);
    expect(zoomedIn.viewEndSec - zoomedIn.viewStartSec).toBeCloseTo(60, 5);
    expect(viewportRatioToSec(cursorRatio, zoomedIn)).toBeCloseTo(30, 5);

    const zoomedFurther = zoomAroundAnchor(zoomedIn, duration, 0.75, 2);
    const expectedAnchor = viewportRatioToSec(0.75, zoomedIn);
    expect(zoomedFurther.zoom).toBeCloseTo(4, 5);
    expect(viewportRatioToSec(0.75, zoomedFurther)).toBeCloseTo(expectedAnchor, 5);

    const resetBack = zoomAroundAnchor(zoomedIn, duration, 0.5, 0.2);
    expect(resetBack).toEqual({ zoom: 1, viewStartSec: 0, viewEndSec: 120 });
  });

  it('clamps viewport cleanly at right boundary without shrinking below span', () => {
    const duration = 100;
    const zoomed = zoomAroundAnchor(
      createFullViewport(duration),
      duration,
      0.95,
      4,
    );
    expect(zoomed.viewEndSec).toBeLessThanOrEqual(duration);
    expect(zoomed.viewStartSec).toBeGreaterThanOrEqual(0);
    expect(zoomed.viewEndSec - zoomed.viewStartSec).toBeCloseTo(25, 5);
  });
});

describe('panViewport', () => {
  it('shifts viewport within track bounds while preserving window width', () => {
    const duration = 100;
    const view = { zoom: 4, viewStartSec: 20, viewEndSec: 45 };

    const pannedRight = panViewport(view, duration, 15);
    expect(pannedRight.viewStartSec).toBeCloseTo(35, 6);
    expect(pannedRight.viewEndSec).toBeCloseTo(60, 6);

    const clampedEnd = panViewport(view, duration, 500);
    expect(clampedEnd.viewStartSec).toBeCloseTo(75, 6);
    expect(clampedEnd.viewEndSec).toBeCloseTo(100, 6);

    const clampedStart = panViewport(view, duration, -500);
    expect(clampedStart.viewStartSec).toBeCloseTo(0, 6);
    expect(clampedStart.viewEndSec).toBeCloseTo(25, 6);
  });
});

describe('ensureRangeVisible', () => {
  it('keeps visible ranges untouched, pans narrow offscreen ranges, and zooms out for wide ones', () => {
    const duration = 200;
    const view = { zoom: 10, viewStartSec: 50, viewEndSec: 70 }; // 20s window

    // Already inside [50, 70]
    expect(ensureRangeVisible(view, duration, 55, 65)).toBe(view);

    // Fits inside 20s window -> pans to center [120, 130] (center = 125 => [115, 135])
    const panned = ensureRangeVisible(view, duration, 120, 130);
    expect(panned.zoom).toBe(10);
    expect(panned.viewStartSec).toBeCloseTo(115, 6);
    expect(panned.viewEndSec).toBeCloseTo(135, 6);

    // Wider than 20s window -> zooms out with padding
    const zoomedOut = ensureRangeVisible(view, duration, 10, 60);
    expect(zoomedOut.viewStartSec).toBeLessThanOrEqual(10);
    expect(zoomedOut.viewEndSec).toBeGreaterThanOrEqual(60);
    expect(zoomedOut.zoom).toBeLessThan(10);
  });
});

describe('secToViewportPct and viewportRatioToSec', () => {
  it('maps between seconds and viewport percentage accurately', () => {
    const view = { zoom: 4, viewStartSec: 25, viewEndSec: 50 };
    expect(secToViewportPct(25, view)).toBeCloseTo(0, 6);
    expect(secToViewportPct(37.5, view)).toBeCloseTo(50, 6);
    expect(secToViewportPct(50, view)).toBeCloseTo(100, 6);
    expect(secToViewportPct(0, view)).toBeCloseTo(-100, 6);
    expect(viewportRatioToSec(0.5, view)).toBeCloseTo(37.5, 6);
  });
});

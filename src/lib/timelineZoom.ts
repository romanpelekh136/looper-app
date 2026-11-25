export interface TimelineViewport {
  zoom: number;
  viewStartSec: number;
  viewEndSec: number;
}

const MIN_WINDOW_SEC = 2;
const HARD_MAX_ZOOM = 40;
const ZOOM_SNAP_EPSILON = 1.001;

export function getMaxZoom(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= MIN_WINDOW_SEC) {
    return 1;
  }
  return Math.max(1, Math.min(HARD_MAX_ZOOM, durationSec / MIN_WINDOW_SEC));
}

export function createFullViewport(durationSec: number): TimelineViewport {
  const safeDur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  return {
    zoom: 1,
    viewStartSec: 0,
    viewEndSec: safeDur,
  };
}

export function zoomAroundAnchor(
  view: TimelineViewport,
  durationSec: number,
  cursorRatio: number,
  factor: number,
): TimelineViewport {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return createFullViewport(0);
  }

  const maxZoom = getMaxZoom(durationSec);
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const curZoom = Number.isFinite(view.zoom) && view.zoom >= 1 ? view.zoom : 1;
  const nextZoom = Math.min(maxZoom, Math.max(1, curZoom * safeFactor));

  if (nextZoom <= ZOOM_SNAP_EPSILON) {
    return createFullViewport(durationSec);
  }

  const clampedRatio = Number.isFinite(cursorRatio)
    ? Math.min(1, Math.max(0, cursorRatio))
    : 0.5;
  const curSpan = Math.max(0.001, view.viewEndSec - view.viewStartSec);
  const anchorSec = view.viewStartSec + clampedRatio * curSpan;

  const nextSpan = Math.min(durationSec, durationSec / nextZoom);
  let nextStart = anchorSec - clampedRatio * nextSpan;
  nextStart = Math.min(Math.max(0, nextStart), Math.max(0, durationSec - nextSpan));
  const nextEnd = Math.min(durationSec, nextStart + nextSpan);

  return {
    zoom: durationSec / Math.max(0.001, nextEnd - nextStart),
    viewStartSec: nextStart,
    viewEndSec: nextEnd,
  };
}

export function panViewport(
  view: TimelineViewport,
  durationSec: number,
  deltaSec: number,
): TimelineViewport {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return createFullViewport(0);
  }
  if (view.zoom <= ZOOM_SNAP_EPSILON) {
    return createFullViewport(durationSec);
  }

  const span = Math.min(durationSec, Math.max(0.001, view.viewEndSec - view.viewStartSec));
  const safeDelta = Number.isFinite(deltaSec) ? deltaSec : 0;
  const nextStart = Math.min(
    Math.max(0, view.viewStartSec + safeDelta),
    Math.max(0, durationSec - span),
  );
  const nextEnd = Math.min(durationSec, nextStart + span);

  return {
    zoom: view.zoom,
    viewStartSec: nextStart,
    viewEndSec: nextEnd,
  };
}

export function ensureRangeVisible(
  view: TimelineViewport,
  durationSec: number,
  startSec: number,
  endSec: number,
): TimelineViewport {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return createFullViewport(0);
  }
  if (view.zoom <= ZOOM_SNAP_EPSILON) {
    return createFullViewport(durationSec);
  }

  const targetStart = Math.min(Math.max(0, Math.min(startSec, endSec)), durationSec);
  const targetEnd = Math.min(Math.max(targetStart, Math.max(startSec, endSec)), durationSec);

  if (
    targetStart >= view.viewStartSec - 1e-6 &&
    targetEnd <= view.viewEndSec + 1e-6
  ) {
    return view;
  }

  const curSpan = view.viewEndSec - view.viewStartSec;
  const targetSpan = targetEnd - targetStart;

  if (targetSpan <= curSpan * 0.9) {
    const center = (targetStart + targetEnd) * 0.5;
    const nextStart = Math.min(
      Math.max(0, center - curSpan * 0.5),
      Math.max(0, durationSec - curSpan),
    );
    return {
      zoom: view.zoom,
      viewStartSec: nextStart,
      viewEndSec: Math.min(durationSec, nextStart + curSpan),
    };
  }

  const pad = Math.max(0.5, targetSpan * 0.15);
  const nextStart = Math.max(0, targetStart - pad);
  const nextEnd = Math.min(durationSec, targetEnd + pad);
  const nextSpan = Math.max(0.001, nextEnd - nextStart);
  const nextZoom = durationSec / nextSpan;

  if (nextZoom <= ZOOM_SNAP_EPSILON) {
    return createFullViewport(durationSec);
  }

  return {
    zoom: Math.min(getMaxZoom(durationSec), nextZoom),
    viewStartSec: nextStart,
    viewEndSec: nextEnd,
  };
}

export function secToViewportPct(sec: number, view: TimelineViewport): number {
  const span = view.viewEndSec - view.viewStartSec;
  if (!Number.isFinite(sec) || !Number.isFinite(span) || span <= 0) {
    return 0;
  }
  return ((sec - view.viewStartSec) / span) * 100;
}

export function viewportRatioToSec(ratio: number, view: TimelineViewport): number {
  const clampedRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const span = Math.max(0, view.viewEndSec - view.viewStartSec);
  return view.viewStartSec + clampedRatio * span;
}

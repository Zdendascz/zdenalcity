import type { Point } from './projection';

/**
 * Kamera je čistý stav plus transformace. Neinteraguje se simulací a nesahá
 * na DOM — vstupní události zpracovává `app.ts` a volá sem jen `pan` / `zoomAt`.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export interface Camera {
  /** Bod v projekčních souřadnicích, který leží ve středu viewportu. */
  x: number;
  y: number;
  zoom: number;
}

export function createCamera(x = 0, y = 0, zoom = 1): Camera {
  return { x, y, zoom: clampZoom(zoom) };
}

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function worldToViewport(
  camera: Camera,
  worldX: number,
  worldY: number,
  viewWidth: number,
  viewHeight: number,
): Point {
  return {
    x: (worldX - camera.x) * camera.zoom + viewWidth / 2,
    y: (worldY - camera.y) * camera.zoom + viewHeight / 2,
  };
}

export function viewportToWorld(
  camera: Camera,
  viewX: number,
  viewY: number,
  viewWidth: number,
  viewHeight: number,
): Point {
  return {
    x: (viewX - viewWidth / 2) / camera.zoom + camera.x,
    y: (viewY - viewHeight / 2) / camera.zoom + camera.y,
  };
}

/** Posun o pixely na obrazovce — obsah se drží kurzoru bez ohledu na zoom. */
export function pan(camera: Camera, deltaViewX: number, deltaViewY: number): void {
  camera.x -= deltaViewX / camera.zoom;
  camera.y -= deltaViewY / camera.zoom;
}

/**
 * Zoom **k pozici kurzoru**, ne ke středu obrazovky: bod pod kurzorem zůstane
 * po změně měřítka na stejném místě. Při zastropovaném zoomu se kamera neposune.
 */
export function zoomAt(
  camera: Camera,
  factor: number,
  viewX: number,
  viewY: number,
  viewWidth: number,
  viewHeight: number,
): void {
  const before = viewportToWorld(camera, viewX, viewY, viewWidth, viewHeight);
  camera.zoom = clampZoom(camera.zoom * factor);
  const after = viewportToWorld(camera, viewX, viewY, viewWidth, viewHeight);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
}

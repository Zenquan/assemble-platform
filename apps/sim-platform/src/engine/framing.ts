const DEFAULT_MIN_RADIUS = 14;
const DEFAULT_PADDING = 1.08;
const MIN_HALF_FOV_RADIANS = 0.05;

export interface SphereCameraFit {
  boundingRadius: number;
  verticalFovRadians: number;
  aspectRatio: number;
  minRadius?: number;
  padding?: number;
}

/** 以包围球适配透视相机，并让竖向窄视口受水平视场角约束。 */
export function fitSphereCameraRadius(options: SphereCameraFit): number {
  const aspectRatio = Number.isFinite(options.aspectRatio) && options.aspectRatio > 0
    ? options.aspectRatio
    : 1;
  const rawHalfFov = options.verticalFovRadians / 2;
  const verticalHalfFov = Math.min(
    Math.max(rawHalfFov, MIN_HALF_FOV_RADIANS),
    Math.PI / 2 - MIN_HALF_FOV_RADIANS,
  );
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspectRatio);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const boundingRadius = Math.max(0, options.boundingRadius);
  const padding = options.padding ?? DEFAULT_PADDING;
  const minRadius = options.minRadius ?? DEFAULT_MIN_RADIUS;

  return Math.max(minRadius, (boundingRadius / Math.sin(limitingHalfFov)) * padding);
}

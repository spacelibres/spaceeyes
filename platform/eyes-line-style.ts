// Recovered NASA TrailManager RGB; alpha/hover are applied once by the renderer.
const rgb: Record<string, readonly [number, number, number]> = {
  mercury: [151 / 255, 104 / 255, 172 / 255],
  venus: [176 / 255, 121 / 255, 25 / 255],
  earth: [0, 0.6, 0.8],
  mars: [154 / 255, 78 / 255, 25 / 255],
  jupiter: [218 / 255, 139 / 255, 114 / 255],
  saturn: [213 / 255, 193 / 255, 135 / 255],
  uranus: [104 / 255, 0.8, 218 / 255],
  neptune: [112 / 255, 140 / 255, 227 / 255],
};
export function eyesLineColor(id: string): [number, number, number, number] {
  const c = rgb[id] ?? [1, 1, 1];
  return [c[0], c[1], c[2], 1];
}

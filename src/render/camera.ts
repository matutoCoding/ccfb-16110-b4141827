import { clamp } from '../core/format';
import { identity, invert, lookAt, multiply, perspective, type Mat4 } from './mat4';

export class CameraRig {
  yaw = -0.62;
  pitch = 0.64;
  distance = 88;
  target: [number, number, number] = [0, 0, 0];

  eye(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + Math.sin(this.yaw) * cp * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * cp * this.distance,
    ];
  }

  matrices(aspect: number): { view: Mat4; proj: Mat4; viewProj: Mat4; inverse: Mat4; eye: [number, number, number] } {
    const eye = this.eye();
    const view = lookAt(eye, this.target, [0, 1, 0]);
    const proj = perspective((55 * Math.PI) / 180, Math.max(0.1, aspect), 0.1, 320);
    const viewProj = multiply(proj, view);
    return { view, proj, viewProj, inverse: invert(viewProj), eye };
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.0052;
    this.pitch = clamp(this.pitch + dy * 0.0042, 0.18, 1.42);
  }

  zoom(deltaY: number): void {
    this.distance = clamp(this.distance * Math.exp(deltaY * 0.0011), 18, 190);
  }

  pan(dx: number, dy: number): void {
    const eye = this.eye();
    const forward: [number, number, number] = [
      this.target[0] - eye[0],
      0,
      this.target[2] - eye[2],
    ];
    const len = Math.hypot(...forward) || 1;
    forward[0] /= len;
    forward[2] /= len;
    const right: [number, number, number] = [forward[2], 0, -forward[0]];
    const scale = this.distance * 0.0016;
    this.target[0] += (-right[0] * dx + forward[0] * dy) * scale;
    this.target[2] += (-right[2] * dx + forward[2] * dy) * scale;
    this.target[0] = clamp(this.target[0], -70, 70);
    this.target[2] = clamp(this.target[2], -38, 38);
  }

  ray(inverse: Mat4, ndcX: number, ndcY: number): { origin: [number, number, number]; dir: [number, number, number] } {
    const unproject = (x: number, y: number, z: number): [number, number, number] => {
      const m = inverse;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
      ];
    };
    const p0 = unproject(ndcX, ndcY, -1);
    const p1 = unproject(ndcX, ndcY, 1);
    const dir: [number, number, number] = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const l = Math.hypot(...dir) || 1;
    dir[0] /= l; dir[1] /= l; dir[2] /= l;
    return { origin: p0, dir };
  }

  groundPoint(inverse: Mat4, ndcX: number, ndcY: number): { x: number; z: number } | null {
    const ray = this.ray(inverse, ndcX, ndcY);
    if (Math.abs(ray.dir[1]) < 1e-6) return null;
    const t = -ray.origin[1] / ray.dir[1];
    if (t < 0) return null;
    return { x: ray.origin[0] + ray.dir[0] * t, z: ray.origin[2] + ray.dir[2] * t };
  }
}

export const identityMat = identity;

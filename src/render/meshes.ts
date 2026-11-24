export interface MeshData {
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
}

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    return this.positions.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  build(): MeshData {
    const vertices = new Float32Array((this.positions.length / 3) * 6);
    for (let i = 0, j = 0; i < this.positions.length / 3; i++) {
      vertices[j++] = this.positions[i * 3];
      vertices[j++] = this.positions[i * 3 + 1];
      vertices[j++] = this.positions[i * 3 + 2];
      vertices[j++] = this.normals[i * 3];
      vertices[j++] = this.normals[i * 3 + 1];
      vertices[j++] = this.normals[i * 3 + 2];
    }
    return { vertices, indices: new Uint16Array(this.indices) };
  }
}

export const createCube = (): MeshData => {
  const b = new Builder();
  const faces: number[][][] = [
    [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]],
    [[0.5, 0, -0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5]],
    [[0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5]],
    [[-0.5, 0, 0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [-0.5, 1, 0.5]],
    [[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]],
    [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]],
  ];
  const normals = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  faces.forEach((face, fi) => {
    const n = normals[fi];
    const ids = face.map((p) => b.v(p[0], p[1], p[2], n[0], n[1], n[2]));
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  });
  return b.build();
};

export const createCylinder = (segments = 28): MeshData => {
  const b = new Builder();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    b.v(x, 0, z, x, 0, z);
    b.v(x, 1, z, x, 0, z);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    b.quad(a, a + 2, a + 3, a + 1);
  }
  const topCenter = b.v(0, 1, 0, 0, 1, 0);
  const bottomCenter = b.v(0, 0, 0, 0, -1, 0);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const t0 = b.v(Math.cos(a0), 1, Math.sin(a0), 0, 1, 0);
    const t1 = b.v(Math.cos(a1), 1, Math.sin(a1), 0, 1, 0);
    b.tri(topCenter, t1, t0);
    const b0 = b.v(Math.cos(a0), 0, Math.sin(a0), 0, -1, 0);
    const b1 = b.v(Math.cos(a1), 0, Math.sin(a1), 0, -1, 0);
    b.tri(bottomCenter, b0, b1);
  }
  return b.build();
};

export const createAnnulus = (outerR: number, innerR: number, height: number, segments = 40): MeshData => {
  const b = new Builder();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    b.v(outerR * c, 0, outerR * s, c, 0, s);
    b.v(outerR * c, height, outerR * s, c, 0, s);
    b.v(innerR * c, 0, innerR * s, -c, 0, -s);
    b.v(innerR * c, height, innerR * s, -c, 0, -s);
  }
  for (let i = 0; i < segments; i++) {
    const p = i * 4;
    const q = (i + 1) * 4;
    b.quad(p, q, q + 1, p + 1);
    b.quad(p + 2, p + 3, q + 3, q + 2);
    const ot0 = b.v(outerR * Math.cos((i / segments) * Math.PI * 2), height, outerR * Math.sin((i / segments) * Math.PI * 2), 0, 1, 0);
    const ot1 = b.v(outerR * Math.cos(((i + 1) / segments) * Math.PI * 2), height, outerR * Math.sin(((i + 1) / segments) * Math.PI * 2), 0, 1, 0);
    const it0 = b.v(innerR * Math.cos((i / segments) * Math.PI * 2), height, innerR * Math.sin((i / segments) * Math.PI * 2), 0, 1, 0);
    const it1 = b.v(innerR * Math.cos(((i + 1) / segments) * Math.PI * 2), height, innerR * Math.sin(((i + 1) / segments) * Math.PI * 2), 0, 1, 0);
    b.quad(ot0, ot1, it1, it0);
  }
  return b.build();
};

export const createPlaneUV = (): { vertices: Float32Array; indices: Uint16Array } => ({
  vertices: new Float32Array([
    -0.5, 0, -0.5, 0, 0,
    0.5, 0, -0.5, 1, 0,
    0.5, 0, 0.5, 1, 1,
    -0.5, 0, 0.5, 0, 1,
  ]),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
});

export const createPlane = (): MeshData => {
  const b = new Builder();
  const ids = [
    b.v(-0.5, 0, -0.5, 0, 1, 0),
    b.v(0.5, 0, -0.5, 0, 1, 0),
    b.v(0.5, 0, 0.5, 0, 1, 0),
    b.v(-0.5, 0, 0.5, 0, 1, 0),
  ];
  b.quad(ids[0], ids[1], ids[2], ids[3]);
  return b.build();
};

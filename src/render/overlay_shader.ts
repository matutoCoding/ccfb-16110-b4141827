export const OVERLAY_WGSL = /* wgsl */ `
struct U { mvp: mat4x4f }
@group(0) @binding(0) var<uniform> u: U;

struct II {
  @location(2) m0: vec4f,
  @location(3) m1: vec4f,
  @location(4) m2: vec4f,
  @location(5) m3: vec4f,
  @location(6) color: vec4f,
  @location(7) options: vec4f,
}

struct VO {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) local: vec2f,
  @location(2) color: vec4f,
  @location(3) options: vec4f,
}

@vertex
fn vs(@location(0) p: vec3f, @location(1) uv: vec2f, inst: II) -> VO {
  let model = mat4x4f(inst.m0, inst.m1, inst.m2, inst.m3);
  var out: VO;
  out.clip = u.mvp * model * vec4f(p, 1.0);
  out.uv = uv;
  out.local = p.xz;
  out.color = inst.color;
  out.options = inst.options;
  return out;
}

@fragment
fn fs(in: VO) -> @location(0) vec4f {
  let mode = in.options.x;
  let r = length(in.local * 2.0);
  if (r > 1.0) { discard; }
  if (mode > 1.5) {
    let a = pow(1.0 - r, 2.2) * in.color.a;
    return vec4f(in.color.rgb * 0.35, a * 0.55);
  }
  if (mode > 0.5) {
    let a = pow(1.0 - r, 1.8) * in.color.a;
    return vec4f(in.color.rgb, a);
  }
  let ring = smoothstep(0.70, 0.86, r) * (1.0 - smoothstep(0.96, 1.0, r));
  let fill = (1.0 - smoothstep(0.0, 1.0, r)) * 0.10;
  return vec4f(in.color.rgb, (ring + fill) * in.color.a);
}
`;

export const HEATMAP_WGSL = /* wgsl */ `
struct U { mvp: mat4x4f }
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var texSampler: sampler;

struct VO { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex
fn vs(@location(0) p: vec3f, @location(1) uv: vec2f) -> VO {
  var out: VO;
  out.clip = u.mvp * vec4f(p.x, 0.05, p.z, 1.0);
  out.uv = uv;
  return out;
}
@fragment
fn fs(in: VO) -> @location(0) vec4f {
  let c = textureSample(tex, texSampler, in.uv);
  return vec4f(c.rgb, c.a * 0.82);
}
`;

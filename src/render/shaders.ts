export const GEOMETRY_WGSL = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  view: mat4x4f,
  cameraPos: vec4f,
  mode: vec4f,
}
@group(0) @binding(0) var<uniform> u: U;

struct VI {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) m0: vec4f,
  @location(3) m1: vec4f,
  @location(4) m2: vec4f,
  @location(5) m3: vec4f,
  @location(6) color: vec4f,
  @location(7) props: vec4f,
}
struct VO {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) props: vec4f,
}

@vertex
fn vs(in: VI) -> VO {
  let m = mat4x4f(in.m0, in.m1, in.m2, in.m3);
  var out: VO;
  let w = m * vec4f(in.position, 1.0);
  out.clip = u.viewProj * w;
  out.world = w.xyz;
  out.normal = normalize((m * vec4f(in.normal, 0.0)).xyz);
  out.color = in.color;
  out.props = in.props;
  return out;
}

struct GO {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) position: vec4f,
  @location(3) material: vec4f,
  @location(4) temp: f32,
}

@fragment
fn fs(in: VO) -> GO {
  var out: GO;
  let effect = in.props.w;
  let emissive = select(0.0, 1.0, effect == 1.0 || effect == 3.0);
  let outline = select(0.0, 1.0, effect >= 2.0);
  out.albedo = vec4f(in.color.rgb, 1.0);
  out.normal = vec4f(normalize(in.normal) * 0.5 + 0.5, 1.0);
  out.position = vec4f(in.world, 1.0);
  out.material = vec4f(in.props.y, in.props.z, emissive, outline);
  out.temp = in.props.x;
  return out;
}
`;

export const FULLSCREEN_WGSL = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  view: mat4x4f,
  cameraPos: vec4f,
  mode: vec4f,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var albTex: texture_2d<f32>;
@group(0) @binding(2) var nrmTex: texture_2d<f32>;
@group(0) @binding(3) var posTex: texture_2d<f32>;
@group(0) @binding(4) var matTex: texture_2d<f32>;
@group(0) @binding(5) var tempTex: texture_2d<f32>;

struct Light { pos: vec4f, color: vec4f }
@group(1) @binding(0) var<storage, read> lights: array<Light>;
@group(1) @binding(1) var<storage, read> headers: array<vec2u>;
@group(1) @binding(2) var<storage, read> indices: array<u32>;

struct VO { @builtin(position) clip: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var out: VO;
  out.clip = vec4f(p[vid], 0, 1);
  out.uv = vec2f((p[vid].x + 1.0) * 0.5, (1.0 - p[vid].y) * 0.5);
  return out;
}

fn blackbody(tempC: f32) -> vec3f {
  let t = max(1.0, (tempC + 273.15) / 100.0);
  var r = 255.0; var g = 255.0; var b = 255.0;
  if (t <= 66.0) {
    r = 255.0;
    g = 99.4708025861 * log(max(t, 1.0)) - 161.1195681661;
    b = 0.0;
    if (t >= 19.0) { b = 138.5177312231 * log(t - 10.0) - 305.0447927307; }
  } else {
    r = 329.698727446 * pow(t - 60.0, -0.1332047592);
    g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
    b = 255.0;
  }
  return clamp(vec3f(r, g, b) / 255.0, vec3f(0.0), vec3f(1.0));
}

fn thermalColor(t: f32) -> vec3f {
  let x = clamp((t - 25.0) / 875.0, 0.0, 1.0);
  let c0 = vec3f(0.03, 0.05, 0.18);
  let c1 = vec3f(0.05, 0.35, 0.95);
  let c2 = vec3f(0.0, 0.85, 0.75);
  let c3 = vec3f(0.95, 0.9, 0.15);
  let c4 = vec3f(1.0, 0.32, 0.05);
  let c5 = vec3f(1.0, 0.92, 0.82);
  if (x < 0.22) { return mix(c0, c1, x / 0.22); }
  if (x < 0.42) { return mix(c1, c2, (x - 0.22) / 0.2); }
  if (x < 0.62) { return mix(c2, c3, (x - 0.42) / 0.2); }
  if (x < 0.82) { return mix(c3, c4, (x - 0.62) / 0.2); }
  return mix(c4, c5, (x - 0.82) / 0.18);
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0), vec3f(1));
}

@fragment
fn fs(in: VO) -> @location(0) vec4f {
  let dims = textureDimensions(albTex);
  let px = vec2u(u32(clamp(in.uv.x, 0.0, 0.999999) * f32(dims.x)), u32(clamp(in.uv.y, 0.0, 0.999999) * f32(dims.y)));
  let alb = textureLoad(albTex, vec2i(px), 0);
  let n = normalize(textureLoad(nrmTex, vec2i(px), 0).xyz * 2.0 - 1.0);
  let wp = textureLoad(posTex, vec2i(px), 0);
  let mat = textureLoad(matTex, vec2i(px), 0);
  let temp = textureLoad(tempTex, vec2i(px), 0).x;
  let mode = u.mode.y;
  let night = u.mode.z > 0.5;

  if (wp.w < 0.5) {
    var bg = mix(vec3f(0.70, 0.78, 0.88), vec3f(0.36, 0.43, 0.54), in.uv.y);
    if (night) { bg = mix(vec3f(0.012,0.016,0.035), vec3f(0.05,0.06,0.10), in.uv.y); }
    if (mode > 0.5) { bg = vec3f(0.025,0.035,0.07); }
    return vec4f(pow(bg, vec3f(0.4545)), 1);
  }

  if (mode > 0.5) {
    var c = thermalColor(temp);
    let shade = 0.78 + 0.22 * max(dot(n, normalize(vec3f(-0.35, 0.85, -0.25))), 0.0);
    c *= shade;
    return vec4f(c, 1);
  }

  let V = normalize(u.cameraPos.xyz - wp.xyz);
  let ambientDay = vec3f(0.48,0.53,0.60);
  let ambientNight = vec3f(0.035,0.045,0.075);
  var color = alb.rgb * select(ambientDay, ambientNight, night);
  let sunDir = normalize(vec3f(-0.45, 0.86, -0.28));
  let sun = max(dot(n, sunDir), 0.0);
  let sunColor = select(vec3f(1.35,1.25,1.08), vec3f(0.05,0.06,0.09), night);
  let hemiColor = select(vec3f(0.20,0.23,0.28), vec3f(0.015,0.02,0.04), night);
  color += alb.rgb * sun * sunColor;
  color += alb.rgb * max(n.y, 0.0) * hemiColor;

  let viewZ = (u.view * wp).z;
  let depth = max(0.1, -viewZ);
  let CXY = vec2u(16u, 9u);
  let CZ = 24u;
  let z0 = 2.0; let z1 = 180.0;
  let slice = min(u32(log(max(depth, z0) / z0) / log(z1 / z0) * f32(CZ)), CZ - 1u);
  let tile = vec2u(min(u32(in.uv.x * 16.0), 15u), min(u32(in.uv.y * 9.0), 8u));
  let ch = headers[(slice * 9u + tile.y) * 16u + tile.x];
  for (var k = 0u; k < ch.y; k++) {
    let li = indices[ch.x + k];
    let L = lights[li];
    let lv = L.pos.xyz - wp.xyz;
    let dist = length(lv);
    let ldir = lv / max(dist, 0.001);
    let diff = max(dot(n, ldir), 0.0);
    let att = L.color.w / (1.0 + 0.10 * dist + 0.055 * dist * dist);
    color += alb.rgb * L.color.rgb * diff * att;
    let h = normalize(ldir + V);
    let spec = pow(max(dot(n, h), 0.0), 42.0) * (1.0 - mat.x);
    color += L.color.rgb * spec * att * 0.35;
  }

  if (mat.z > 0.5) {
    let bb = blackbody(temp);
    let pulse = 0.92 + 0.08 * sin(u.mode.x * 2.2 + wp.x * 1.7);
    color += bb * (1.2 + clamp((temp - 350.0) / 500.0, 0.0, 2.2)) * pulse;
  }
  if (mat.w > 0.5) {
    let rim = pow(1.0 - max(dot(n, V), 0.0), 2.2);
    color += vec3f(1.0, 0.08, 0.03) * (0.7 + rim * 1.8) * (0.75 + 0.25 * sin(u.mode.x * 5.0));
  }

  color = aces(max(color, vec3f(0.0)));
  color = pow(color, vec3f(0.4545));
  return vec4f(color, alb.a);
}
`;

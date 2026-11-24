import { clamp } from '../core/format';
import { geoInfo } from '../core/geometry';
import type { AppData, Vec2 } from '../core/types';
import { CameraRig } from './camera';
import { composeModel, multiply } from './mat4';
import { buildClusters, type CpuLight } from './clusters';
import { GEOMETRY_WGSL, FULLSCREEN_WGSL } from './shaders';
import { OVERLAY_WGSL, HEATMAP_WGSL } from './overlay_shader';
import { createPlaneUV, type MeshData } from './meshes';
import { blackbodyRgb } from './blackbody';
import { buildScene, type Pickable, type SceneBatch } from './scene_builder';
import { buildOverlays, packOverlay } from './overlay_builder';

export interface RenderFrameOptions {
  data: AppData;
  tempsC: Float32Array;
  failed: Set<string>;
  selectedId?: string;
  mode: 'visible' | 'thermal';
  split: boolean;
  night: boolean;
  showMarkers: boolean;
  heatmapCanvas?: HTMLCanvasElement | null;
}

interface GpuMesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  count: number;
  format: GPUIndexFormat;
}

interface BatchRuntime {
  instanceBuffer: GPUBuffer;
  capacity: number;
}

interface ViewGpu {
  uniformBuffer: GPUBuffer;
  uniformData: Float32Array;
  geoBind: GPUBindGroup;
  lightBind?: GPUBindGroup;
  clusterBind?: GPUBindGroup;
  lightBuffer: GPUBuffer;
  headerBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  overlayUniform: GPUBuffer;
  heatUniform: GPUBuffer;
  overlayBind: GPUBindGroup;
  glowBind: GPUBindGroup;
  heatBind0: GPUBindGroup;
}

const MAX_LIGHTS = 512;
const MAX_INDICES = 260_000;

export class WebGpuStage {
  canvas: HTMLCanvasElement;
  device: GPUDevice | null = null;
  context: GPUCanvasContext | null = null;
  format: GPUTextureFormat = 'bgra8unorm';
  ready = false;
  unsupported = false;
  camera = new CameraRig();
  pickables: Pickable[] = [];
  fps = 0;

  private width = 1;
  private height = 1;
  private geoPipeline: GPURenderPipeline | null = null;
  private lightPipeline: GPURenderPipeline | null = null;
  private overlayPipeline: GPURenderPipeline | null = null;
  private glowPipeline: GPURenderPipeline | null = null;
  private heatPipeline: GPURenderPipeline | null = null;
  private targetViews: GPUTextureView[] = [];
  private depthView: GPUTextureView | null = null;
  private targetTextures: GPUTexture[] = [];
  private views: ViewGpu[] = [];
  private meshCache = new Map<string, GpuMesh>();
  private batchCache = new Map<string, BatchRuntime>();
  private planeMesh: GpuMesh | null = null;
  private heatTexture: GPUTexture | null = null;
  private heatBind1: GPUBindGroup | null = null;
  private heatSampler: GPUSampler | null = null;
  private heatVersion = -1;
  private frameCount = 0;
  private fpsAt = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(): Promise<boolean> {
    if (!navigator.gpu) {
      this.unsupported = true;
      return false;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        this.unsupported = true;
        return false;
      }
      const requiredLimits: Record<string, number> = {};
      if (adapter.limits.maxColorAttachmentBytesPerSample >= 64) {
        requiredLimits.maxColorAttachmentBytesPerSample = 64;
      }
      this.device = await adapter.requestDevice({ requiredLimits });
      this.device.addEventListener('uncapturederror', (event: GPUUncapturedErrorEvent) => {
        console.error('WEBGPU_ERROR', event.error.message);
      });
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) return false;
      this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
      this.resize(true);
      this.createPipelines();
      this.views = [this.createView(), this.createView()];
      this.ready = true;
      return true;
    } catch (error) {
      console.error('WebGPU 初始化失败', error);
      this.unsupported = true;
      return false;
    }
  }

  resize(force = false): void {
    if (!this.device) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.max(2, Math.floor(rect.width * dpr));
    const h = Math.max(2, Math.floor(rect.height * dpr));
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.createTargets();
  }

  private createTargets(): void {
    if (!this.device) return;
    this.targetTextures.forEach((t) => t.destroy());
    const device = this.device;
    const w = this.width;
    const h = this.height;
    const desc = (format: GPUTextureFormat): GPUTextureDescriptor => ({
      size: [w, h],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const formats: GPUTextureFormat[] = ['rgba8unorm', 'rgba8unorm', 'rgba16float', 'rgba8unorm', 'r16float'];
    this.targetTextures = formats.map((format) => device.createTexture(desc(format)));
    this.targetViews = this.targetTextures.map((t) => t.createView());
    const depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depthView = depth.createView();
  }

  private createPipelines(): void {
    const device = this.device!;
    const geoModule = device.createShaderModule({ code: GEOMETRY_WGSL });
    this.geoPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: geoModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
          {
            arrayStride: 96,
            stepMode: 'instance',
            attributes: [2, 3, 4, 5].map((location, i) => ({ shaderLocation: location, offset: i * 16, format: 'float32x4' as const })).concat([
              { shaderLocation: 6, offset: 64, format: 'float32x4' as const },
              { shaderLocation: 7, offset: 80, format: 'float32x4' as const },
            ]),
          },
        ],
      },
      fragment: {
        module: geoModule,
        entryPoint: 'fs',
        targets: [
          { format: 'rgba8unorm' },
          { format: 'rgba8unorm' },
          { format: 'rgba16float' },
          { format: 'rgba8unorm' },
          { format: 'r16float' },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const lightModule = device.createShaderModule({ code: FULLSCREEN_WGSL });
    this.lightPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: lightModule, entryPoint: 'vs' },
      fragment: { module: lightModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });

    const overlayModule = device.createShaderModule({ code: OVERLAY_WGSL });
    const overlayLayout: GPUVertexBufferLayout = {
      arrayStride: 20,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x2' },
      ],
    };
    const instanceLayout: GPUVertexBufferLayout = {
      arrayStride: 96,
      stepMode: 'instance',
      attributes: [2, 3, 4, 5].map((location, i) => ({ shaderLocation: location, offset: i * 16, format: 'float32x4' as const })).concat([
        { shaderLocation: 6, offset: 64, format: 'float32x4' },
        { shaderLocation: 7, offset: 80, format: 'float32x4' },
      ]),
    };
    const blend: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const additive: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    };
    const depthState: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' };
    this.overlayPipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: overlayModule, entryPoint: 'vs', buffers: [overlayLayout, instanceLayout] },
      fragment: { module: overlayModule, entryPoint: 'fs', targets: [{ format: this.format, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depthState,
    });
    this.glowPipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: overlayModule, entryPoint: 'vs', buffers: [overlayLayout, instanceLayout] },
      fragment: { module: overlayModule, entryPoint: 'fs', targets: [{ format: this.format, blend: additive }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depthState,
    });

    const heatModule = device.createShaderModule({ code: HEATMAP_WGSL });
    this.heatPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: heatModule, entryPoint: 'vs', buffers: [overlayLayout] },
      fragment: { module: heatModule, entryPoint: 'fs', targets: [{ format: this.format, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState,
    });
    const plane = createPlaneUV();
    this.planeMesh = this.createMeshBufferFromData(plane.vertices, plane.indices);
    this.heatSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  private createView(): ViewGpu {
    const device = this.device!;
    const uniformBuffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const uniformData = new Float32Array(64);
    const geoBind = device.createBindGroup({
      layout: this.geoPipeline!.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    const lightBuffer = device.createBuffer({ size: MAX_LIGHTS * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const headerBuffer = device.createBuffer({ size: 16 * 9 * 24 * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const indexBuffer = device.createBuffer({ size: MAX_INDICES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const overlayUniform = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const heatUniform = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const overlayBind = device.createBindGroup({
      layout: this.overlayPipeline!.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: overlayUniform } }],
    });
    const glowBind = device.createBindGroup({
      layout: this.glowPipeline!.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: overlayUniform } }],
    });
    const heatBind0 = device.createBindGroup({
      layout: this.heatPipeline!.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: heatUniform } }],
    });
    return { uniformBuffer, uniformData, geoBind, lightBuffer, headerBuffer, indexBuffer, overlayUniform, heatUniform, overlayBind, glowBind, heatBind0 };
  }

  private createMeshBufferFromData(vertices: Float32Array, indices: Uint16Array | Uint32Array): GpuMesh {
    const device = this.device!;
    const vertex = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertex, 0, vertices as unknown as BufferSource);
    const index = device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(index, 0, indices as unknown as BufferSource);
    return { vertex, index, count: indices.length, format: indices instanceof Uint32Array ? 'uint32' : 'uint16' };
  }

  private getMesh(batch: SceneBatch): GpuMesh {
    const cached = this.meshCache.get(batch.key);
    if (cached) return cached;
    const mesh = this.createMeshBufferFromData(batch.mesh!.vertices, batch.mesh!.indices);
    this.meshCache.set(batch.key, mesh);
    return mesh;
  }

  private getInstanceBuffer(key: string, count: number): { runtime: BatchRuntime; buffer: GPUBuffer } {
    const device = this.device!;
    let runtime = this.batchCache.get(key);
    if (!runtime || runtime.capacity < count) {
      const capacity = Math.max(16, Math.ceil(count * 1.35));
      const instanceBuffer = device.createBuffer({ size: capacity * 96, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      runtime = { instanceBuffer, capacity };
      this.batchCache.set(key, runtime);
    }
    return { runtime, buffer: runtime.instanceBuffer };
  }

  clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * this.width, y: ((clientY - rect.top) / rect.height) * this.height };
  }

  pickablesAt(): Pickable[] {
    return this.pickables;
  }

  private viewportForClient(clientX: number, clientY: number): {
    vp: { x: number; y: number; w: number; h: number };
    ndcX: number;
    ndcY: number;
    aspect: number;
  } {
    const rect = this.canvas.getBoundingClientRect();
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    const split = this.split && rect.width > 700;
    const half = rect.width / 2;
    const left = !split || cssX < half;
    const localX = split && !left ? cssX - half : cssX;
    const cssW = split ? half : rect.width;
    const ndcX = (localX / cssW) * 2 - 1;
    const ndcY = -((cssY / rect.height) * 2 - 1);
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    const vp = split
      ? { x: left ? 0 : Math.floor(half * scaleX), y: 0, w: Math.floor(half * scaleX), h: this.height }
      : { x: 0, y: 0, w: this.width, h: this.height };
    if (split && !left) vp.w = this.width - vp.x;
    return { vp, ndcX, ndcY, aspect: cssW / rect.height };
  }

  groundPoint(clientX: number, clientY: number): Vec2 | null {
    if (!this.ready) return null;
    const q = this.viewportForClient(clientX, clientY);
    const mat = this.camera.matrices(q.aspect);
    return this.camera.groundPoint(mat.inverse, q.ndcX, q.ndcY);
  }

  pick(clientX: number, clientY: number): Pickable | null {
    const ground = this.groundPoint(clientX, clientY);
    if (!ground) return null;
    let best: Pickable | null = null;
    let bestD = Infinity;
    for (const p of this.pickables) {
      let hit = false;
      if (p.kind !== 'object') {
        hit = Math.hypot(ground.x - p.x, ground.z - p.z) <= (p.radius ?? 0.6);
      } else {
        const rot = p.rotation ?? 0;
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const dx = ground.x - p.x;
        const dz = ground.z - p.z;
        const lx = c * dx - s * dz;
        const lz = s * dx + c * dz;
        hit = Math.abs(lx) <= (p.width ?? 1) / 2 && Math.abs(lz) <= (p.depth ?? 1) / 2;
      }
      if (hit) {
        const d = Math.hypot(ground.x - p.x, ground.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }

  private split = false;

  render(options: RenderFrameOptions): void {
    if (!this.ready || !this.device || !this.context) return;
    this.resize();
    this.split = options.split;
    const device = this.device;
    const scene = buildScene(options.data, {
      tempsC: options.tempsC,
      failed: options.failed,
      selectedId: options.selectedId,
      night: options.night,
      showMarkers: options.showMarkers,
    });
    this.pickables = scene.pickables;

    const halfW = Math.floor(this.width / 2);
    const viewports = options.split && this.width > 700
      ? [
          { x: 0, y: 0, w: halfW, h: this.height },
          { x: halfW, y: 0, w: this.width - halfW, h: this.height },
        ]
      : [{ x: 0, y: 0, w: this.width, h: this.height }];

    viewports.forEach((vp, i) => {
      const mode = options.split ? (i === 0 ? 'visible' : 'thermal') : options.mode;
      this.updateView(i, vp, options, mode);
    });
    this.updateHeatmapTexture(options.heatmapCanvas ?? null);

    const packed = scene.batches.map((batch) => {
      const data = new Float32Array(batch.instances.length * 24);
      batch.instances.forEach((item, j) => {
        data.set(item.model, j * 24);
        data.set(item.color, j * 24 + 16);
        data.set([item.temp, item.rough, item.metal, item.emissive + item.outline * 2], j * 24 + 20);
      });
      const { buffer } = this.getInstanceBuffer(batch.key, Math.max(1, batch.instances.length));
      if (batch.instances.length) device.queue.writeBuffer(buffer, 0, data as unknown as BufferSource);
      return { batch, buffer, count: batch.instances.length };
    });

    const overlay = buildOverlays(options.data, options.tempsC, options.failed, options.selectedId);
    const normalPacked = packOverlay(overlay.normal);
    const glowPacked = packOverlay(overlay.glow);
    const normalBuffer = this.getDynamicBuffer('overlay-normal', Math.max(1, normalPacked.length * 4));
    const glowBuffer = this.getDynamicBuffer('overlay-glow', Math.max(1, glowPacked.length * 4));
    if (overlay.normal.length) device.queue.writeBuffer(normalBuffer, 0, normalPacked as unknown as BufferSource);
    if (overlay.glow.length) device.queue.writeBuffer(glowBuffer, 0, glowPacked as unknown as BufferSource);

    const encoder = device.createCommandEncoder();
    const geoPass = encoder.beginRenderPass({
      colorAttachments: this.targetViews.map((view, i) => ({
        view,
        clearValue: i === 2 ? { r: 0, g: 0, b: 0, a: 0 } : { r: 0.04, g: 0.05, b: 0.08, a: 1 },
        loadOp: 'clear' as const,
        storeOp: 'store' as const,
      })),
      depthStencilAttachment: { view: this.depthView!, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    geoPass.setPipeline(this.geoPipeline!);
    viewports.forEach((vp, i) => {
      geoPass.setViewport(vp.x, vp.y, vp.w, vp.h, 0, 1);
      geoPass.setScissorRect(vp.x, vp.y, vp.w, vp.h);
      geoPass.setBindGroup(0, this.views[i].geoBind);
      for (const item of packed) {
        if (!item.count) continue;
        const mesh = this.getMesh(item.batch);
        geoPass.setVertexBuffer(0, mesh.vertex);
        geoPass.setVertexBuffer(1, item.buffer);
        geoPass.setIndexBuffer(mesh.index, mesh.format);
        geoPass.drawIndexed(mesh.count, item.count);
      }
    });
    geoPass.end();

    const canvasView = this.context.getCurrentTexture().createView();
    const lightPass = encoder.beginRenderPass({
      colorAttachments: [{ view: canvasView, clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    lightPass.setPipeline(this.lightPipeline!);
    viewports.forEach((vp, i) => {
      const view = this.views[i];
      if (!view.lightBind || !view.clusterBind) return;
      lightPass.setViewport(vp.x, vp.y, vp.w, vp.h, 0, 1);
      lightPass.setScissorRect(vp.x, vp.y, vp.w, vp.h);
      lightPass.setBindGroup(0, view.lightBind);
      lightPass.setBindGroup(1, view.clusterBind);
      lightPass.draw(3);
    });
    lightPass.end();

    const overlayPass = encoder.beginRenderPass({
      colorAttachments: [{ view: canvasView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depthView!, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    if (this.planeMesh) {
      viewports.forEach((vp, i) => {
        const view = this.views[i];
        overlayPass.setViewport(vp.x, vp.y, vp.w, vp.h, 0, 1);
        overlayPass.setScissorRect(vp.x, vp.y, vp.w, vp.h);
        const mat = this.camera.matrices(vp.w / vp.h);
        const u = new Float32Array(32);
        u.set(mat.viewProj, 0);
        device.queue.writeBuffer(view.overlayUniform, 0, u as unknown as BufferSource);
        overlayPass.setBindGroup(0, view.overlayBind);
        overlayPass.setVertexBuffer(0, this.planeMesh!.vertex);
        overlayPass.setIndexBuffer(this.planeMesh!.index, this.planeMesh!.format);

        if (options.heatmapCanvas && this.heatBind1) {
          const heatMvp = multiply(
            mat.viewProj,
            composeModel(0, 0, 0, 0, options.data.site.width, 1, options.data.site.depth),
          );
          device.queue.writeBuffer(view.heatUniform, 0, heatMvp as unknown as BufferSource);
          overlayPass.setPipeline(this.heatPipeline!);
          overlayPass.setBindGroup(0, view.heatBind0);
          overlayPass.setBindGroup(1, this.heatBind1);
          overlayPass.drawIndexed(this.planeMesh!.count, 1, 0, 0, 0);
        }

        overlayPass.setPipeline(this.overlayPipeline!);
        overlayPass.setBindGroup(0, view.overlayBind);
        overlayPass.setVertexBuffer(1, normalBuffer);
        if (overlay.normal.length) overlayPass.drawIndexed(6, overlay.normal.length);
        overlayPass.setPipeline(this.glowPipeline!);
        overlayPass.setBindGroup(0, view.glowBind);
        overlayPass.setVertexBuffer(1, glowBuffer);
        if (overlay.glow.length) overlayPass.drawIndexed(6, overlay.glow.length);
      });
    }
    overlayPass.end();
    device.queue.submit([encoder.finish()]);

    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsAt > 600) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsAt));
      this.frameCount = 0;
      this.fpsAt = now;
    }
  }

  private dynamicBuffers = new Map<string, GPUBuffer>();
  private getDynamicBuffer(key: string, bytes: number): GPUBuffer {
    let buffer = this.dynamicBuffers.get(key);
    if (!buffer || buffer.size < bytes) {
      buffer?.destroy();
      buffer = this.device!.createBuffer({ size: Math.max(256, bytes * 2), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.dynamicBuffers.set(key, buffer);
    }
    return buffer;
  }

  private updateView(
    index: number,
    vp: { x: number; y: number; w: number; h: number },
    options: RenderFrameOptions,
    mode: 'visible' | 'thermal' = options.mode,
  ): void {
    while (this.views.length <= index) this.views.push(this.createView());
    const view = this.views[index];
    const mat = this.camera.matrices(vp.w / vp.h);
    view.uniformData.set(mat.viewProj, 0);
    view.uniformData.set(mat.view, 16);
    view.uniformData.set(mat.eye, 32);
    view.uniformData.set([performance.now() / 1000, mode === 'thermal' ? 1 : 0, options.night ? 1 : 0, options.split ? 1 : 0], 36);
    this.device!.queue.writeBuffer(view.uniformBuffer, 0, view.uniformData as unknown as BufferSource);

    const lights: CpuLight[] = options.data.forgings.map((f, i) => {
      const temp = options.tempsC[i] ?? f.dischargeTempC;
      const [r, g, b] = blackbodyRgb(temp);
      const tk = (temp + 273.15) / 1000;
      return {
        x: f.position.x,
        y: Math.max(0.7, geoInfo(f.kind, f.dims).height * 0.7),
        z: f.position.z,
        range: 15,
        r: r * 1.5,
        g: g * 1.15,
        b: b * 0.85,
        intensity: 2.5 * tk ** 4 * clamp(geoInfo(f.kind, f.dims).area / 12, 0.55, 1.8),
      };
    });
    const clusters = buildClusters(lights, mat.view, mat.viewProj, vp.w / vp.h);
    this.device!.queue.writeBuffer(view.lightBuffer, 0, clusters.lights as unknown as BufferSource);
    this.device!.queue.writeBuffer(view.headerBuffer, 0, clusters.headers as unknown as BufferSource);
    this.device!.queue.writeBuffer(view.indexBuffer, 0, clusters.indices as unknown as BufferSource);
    view.lightBind = this.device!.createBindGroup({
      layout: this.lightPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: view.uniformBuffer } },
        { binding: 1, resource: this.targetViews[0] },
        { binding: 2, resource: this.targetViews[1] },
        { binding: 3, resource: this.targetViews[2] },
        { binding: 4, resource: this.targetViews[3] },
        { binding: 5, resource: this.targetViews[4] },
      ],
    });
    view.clusterBind = this.device!.createBindGroup({
      layout: this.lightPipeline!.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: view.lightBuffer } },
        { binding: 1, resource: { buffer: view.headerBuffer } },
        { binding: 2, resource: { buffer: view.indexBuffer } },
      ],
    });
  }

  private updateHeatmapTexture(canvas: HTMLCanvasElement | null): void {
    if (!this.device || !canvas || canvas === this.heatmapSource) return;
    this.heatmapSource = canvas;
    this.heatTexture?.destroy();
    this.heatTexture = this.device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: this.heatTexture }, [canvas.width, canvas.height]);
    this.heatBind1 = this.device.createBindGroup({
      layout: this.heatPipeline!.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.heatTexture.createView() },
        { binding: 1, resource: this.heatSampler! },
      ],
    });
  }
  private heatmapSource: HTMLCanvasElement | null = null;
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Shared opaque geometry pipeline for Native readback and browser Surface presentation. No mutable Scene/Time access.
use crate::{mesh, DrawMaterial, PreparedFrame, RenderError};
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{ColorSpace, Sampling, TextureAddress, TextureData, TextureFilter};
use spaceeyes_resources::ResourceManager;
use std::sync::Arc;
#[cfg(not(target_arch = "wasm32"))]
use wgpu::util::DeviceExt;

pub struct GpuRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    line_pipeline: wgpu::RenderPipeline,
    transparent_pipeline: wgpu::RenderPipeline,
    material_layout: wgpu::BindGroupLayout,
    pub adapter_name: String,
}
impl GpuRenderer {
    pub async fn new() -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .map_err(|_| RenderError::NoAdapter)?;
        let adapter_name = adapter.get_info().name;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| RenderError::Device(e.to_string()))?;
        let mut renderer = Self::from_device(device, queue, wgpu::TextureFormat::Rgba8Unorm);
        renderer.adapter_name = adapter_name;
        Ok(renderer)
    }
    fn from_device(device: wgpu::Device, queue: wgpu::Queue, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("SpaceEyes opaque geometry"),
            source: wgpu::ShaderSource::Wgsl(include_str!("opaque.wgsl").into()),
        });
        let material_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("SpaceEyes material layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("SpaceEyes pipeline layout"),
            bind_group_layouts: &[Some(&material_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("SpaceEyes depth-tested opaque pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 56,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x4,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 16,
                            shader_location: 1,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 28,
                            shader_location: 2,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 40,
                            shader_location: 3,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: 48,
                            shader_location: 4,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: 52,
                            shader_location: 5,
                        },
                    ],
                })],
            },
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::LessEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let line_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("SpaceEyes depth-tested line pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 56,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x4,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 16,
                            shader_location: 1,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 28,
                            shader_location: 2,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 40,
                            shader_location: 3,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: 48,
                            shader_location: 4,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: 52,
                            shader_location: 5,
                        },
                    ],
                })],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::LessEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let transparent_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("SpaceEyes transparent pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 56,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x4,
                            offset: 0,
                            shader_location: 0,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 16,
                            shader_location: 1,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x3,
                            offset: 28,
                            shader_location: 2,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32x2,
                            offset: 40,
                            shader_location: 3,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: 48,
                            shader_location: 4,
                        },
                        wgpu::VertexAttribute {
                            format: wgpu::VertexFormat::Float32,
                            offset: 52,
                            shader_location: 5,
                        },
                    ],
                })],
            },
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::LessEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Self {
            device,
            queue,
            pipeline,
            line_pipeline,
            transparent_pipeline,
            material_layout,
            adapter_name: String::new(),
        }
    }
    fn frame_budget(&self, frame: &PreparedFrame) -> Result<(u32, u64, u64), RenderError> {
        let marker_vertices = u32::try_from(frame.markers.len())
            .ok()
            .and_then(|n| n.checked_mul(3))
            .ok_or(RenderError::Budget)?;
        let sphere_vertices = u32::try_from(frame.spheres.len())
            .ok()
            .and_then(|n| n.checked_mul(mesh::SPHERE_DRAW_VERTICES))
            .ok_or(RenderError::Budget)?;
        let mesh_vertices = frame
            .meshes
            .iter()
            .try_fold(0u32, |n, draw| {
                n.checked_add(u32::try_from(draw.geometry.indices().len()).ok()?)
            })
            .ok_or(RenderError::Budget)?;
        let line_vertices = frame
            .lines
            .iter()
            .try_fold(0u32, |n, line| {
                let segments = u32::try_from(line.points.len().saturating_sub(1)).ok()?;
                n.checked_add(segments.checked_mul(2)?)
            })
            .ok_or(RenderError::Budget)?;
        let vertices = marker_vertices
            .checked_add(sphere_vertices)
            .and_then(|n| n.checked_add(mesh_vertices))
            .and_then(|n| n.checked_add(line_vertices))
            .ok_or(RenderError::Budget)?;
        let vertex_bytes = u64::from(vertices.max(1)) * 56;
        if vertex_bytes > self.device.limits().max_buffer_size {
            return Err(RenderError::Budget);
        }
        if frame.spheres.len() + frame.meshes.len() + frame.lines.len() > 4096 {
            return Err(RenderError::Budget);
        }
        let texture_bytes = texture_assets(frame)
            .iter()
            .try_fold(4u64, |n, t| n.checked_add(t.byte_len()))
            .ok_or(RenderError::Budget)?;
        let gpu_bytes = vertex_bytes
            .checked_add(texture_bytes)
            .ok_or(RenderError::Budget)?;
        let staging_bytes = gpu_bytes;
        #[cfg(target_arch = "wasm32")]
        let staging_bytes = staging_bytes
            .checked_add(vertex_bytes)
            .ok_or(RenderError::Budget)?;
        Ok((vertices, gpu_bytes, staging_bytes))
    }
    fn upload_frame(&self, frame: &PreparedFrame, vertices: u32) -> Result<GpuFrame, RenderError> {
        let mut data = Vec::with_capacity(vertices as usize * 56);
        let assets = texture_assets(frame);
        let mut gpu_textures = vec![self.upload_texture(
            &TextureData::new(1, 1, vec![255; 4], ColorSpace::Linear).expect("white texel"),
        )];
        for texture in &assets {
            gpu_textures.push(self.upload_texture(texture));
        }
        let mut bindings = vec![self.bind_texture(&gpu_textures[0], Sampling::default())];
        let mut batches = Vec::new();
        let mut transparent_batches = Vec::new();
        let mut line_batches = Vec::new();
        let mut cursor = 0u32;
        let mut marker_material = DrawMaterial::plain([1.0, 0.5, 0.0]);
        marker_material.unlit = true;
        for marker in &frame.markers {
            if !marker.ndc.iter().all(|v| v.is_finite()) {
                return Err(RenderError::InvalidFrame);
            }
            for [dx, dy] in [[-0.035, -0.035], [0.035, -0.035], [0.0, 0.035]] {
                pack_vertex(
                    &mut data,
                    [marker.ndc[0] + dx, marker.ndc[1] + dy, marker.ndc[2], 1.0],
                    [0.0; 3],
                    [0.0; 2],
                    &marker_material,
                )?;
            }
            cursor += 3;
        }
        if cursor > 0 {
            batches.push((0..cursor, 0usize));
        }
        if !frame.spheres.is_empty() {
            let mesh = mesh::unit_sphere(mesh::SPHERE_SLICES, mesh::SPHERE_STACKS)?;
            for sphere in &frame.spheres {
                if !sphere.radius_m.is_finite() || sphere.radius_m <= 0.0 {
                    return Err(RenderError::InvalidFrame);
                }
                let start = cursor;
                for &index in &mesh.indices {
                    let vertex = mesh.vertices[index as usize];
                    let [x, y, z] = vertex.position;
                    let normal = sphere.rotation_to_camera.apply(spaceeyes_spatial::Vec3d {
                        x: f64::from(x),
                        y: f64::from(y),
                        z: f64::from(z),
                    });
                    let n = [normal.x, normal.y, normal.z];
                    let position = std::array::from_fn(|axis| {
                        sphere.center_camera[axis] + n[axis] * sphere.radius_m
                    });
                    pack_vertex(
                        &mut data,
                        frame.projection.clip(position)?,
                        n.map(|n| n as f32),
                        vertex.uv,
                        &sphere.material,
                    )?;
                    cursor += 1;
                }
                let binding =
                    self.material_binding(&sphere.material, &assets, &gpu_textures, &mut bindings);
                if sphere.material.alpha < 1.0 {
                    transparent_batches.push((start..cursor, binding));
                } else {
                    batches.push((start..cursor, binding));
                }
            }
        }
        for draw in &frame.meshes {
            let start = cursor;
            let rotation = spaceeyes_spatial::RigidTransform::new(
                spaceeyes_spatial::Vec3d::ZERO,
                draw.object_to_camera.rotation,
            )
            .map_err(|_| RenderError::InvalidFrame)?;
            for &index in draw.geometry.indices() {
                let vertex = &draw.geometry.vertices()[index as usize];
                let [x, y, z] = vertex.normal();
                let normal = rotation.apply(spaceeyes_spatial::Vec3d { x, y, z });
                pack_vertex(
                    &mut data,
                    frame.projection.clip(draw.point(index))?,
                    [normal.x as f32, normal.y as f32, normal.z as f32],
                    vertex.uv(),
                    &draw.material,
                )?;
                cursor += 1;
            }
            let binding =
                self.material_binding(&draw.material, &assets, &gpu_textures, &mut bindings);
            if draw.material.alpha < 1.0 {
                transparent_batches.push((start..cursor, binding));
            } else {
                batches.push((start..cursor, binding));
            }
        }
        for line in &frame.lines {
            if line.points.len() < 2 {
                continue;
            }
            let start = cursor;
            let mut material = crate::DrawMaterial::plain(line.color);
            material.unlit = true;
            for pair in line.points.windows(2) {
                for point in pair {
                    pack_vertex(
                        &mut data,
                        frame.projection.clip(*point)?,
                        [0.0; 3],
                        [0.0; 2],
                        &material,
                    )?;
                    cursor += 1;
                }
            }
            let binding = self.material_binding(&material, &assets, &gpu_textures, &mut bindings);
            line_batches.push((start..cursor, binding));
        }
        debug_assert_eq!(cursor, vertices);
        if data.is_empty() {
            data.resize(56, 0);
        }
        #[cfg(not(target_arch = "wasm32"))]
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("opaque vertices"),
                contents: &data,
                usage: wgpu::BufferUsages::VERTEX,
            });
        #[cfg(target_arch = "wasm32")]
        let buffer = {
            let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("opaque streaming vertices"),
                size: data.len() as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.queue.write_buffer(&buffer, 0, &data);
            buffer
        };
        Ok(GpuFrame {
            buffer,
            bindings,
            batches,
            transparent_batches,
            line_batches,
        })
    }
    fn encode_frame(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        depth_view: &wgpu::TextureView,
        draw: &GpuFrame,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_vertex_buffer(0, draw.buffer.slice(..));
        for (range, binding) in &draw.batches {
            pass.set_bind_group(0, &draw.bindings[*binding], &[]);
            pass.draw(range.clone(), 0..1);
        }
        if !draw.line_batches.is_empty() {
            pass.set_pipeline(&self.line_pipeline);
            for (range, binding) in &draw.line_batches {
                pass.set_bind_group(0, &draw.bindings[*binding], &[]);
                pass.draw(range.clone(), 0..1);
            }
        }
        if !draw.transparent_batches.is_empty() {
            pass.set_pipeline(&self.transparent_pipeline);
            for (range, binding) in &draw.transparent_batches {
                pass.set_bind_group(0, &draw.bindings[*binding], &[]);
                pass.draw(range.clone(), 0..1);
            }
        }
    }
    /// Native readback path; browser presentation needs its async surface adapter.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn render_rgba8(
        &self,
        frame: &PreparedFrame,
        width: u32,
        height: u32,
        resources: &mut ResourceManager,
    ) -> Result<Vec<u8>, RenderError> {
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err(RenderError::InvalidFrame);
        }
        let row = (width * 4).div_ceil(256) * 256;
        let bytes = u64::from(row) * u64::from(height);
        let (vertices, geometry_bytes, frame_staging) = self.frame_budget(frame)?;
        let reserve = bytes
            .checked_add(u64::from(width) * u64::from(height) * 8)
            .and_then(|n| n.checked_add(geometry_bytes))
            .ok_or(RenderError::Budget)?;
        let id = ResourceId::new("spaceeyes:gpu:offscreen-scratch").expect("static ID");
        let staging = frame_staging
            .checked_add(bytes)
            .and_then(|n| n.checked_add(u64::from(width) * u64::from(height) * 4))
            .ok_or(RenderError::Budget)?;
        let staging_id = ResourceId::new("spaceeyes:staging:offscreen-frame").expect("static ID");
        let reservation = resources
            .reserve_frame(id, reserve, staging_id, staging)
            .map_err(|_| RenderError::Budget)?;
        let outcome = self.render_inner(frame, width, height, row, bytes, vertices);
        resources
            .release_frame(&reservation)
            .map_err(|_| RenderError::Budget)?;
        outcome
    }
    #[cfg(not(target_arch = "wasm32"))]
    fn render_inner(
        &self,
        frame: &PreparedFrame,
        width: u32,
        height: u32,
        row: u32,
        bytes: u64,
        vertices: u32,
    ) -> Result<Vec<u8>, RenderError> {
        let draw = self.upload_frame(frame, vertices)?;
        let size = wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("offscreen"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let depth = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("offscreen depth"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let depth_view = depth.create_view(&Default::default());
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: bytes,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.encode_frame(&mut encoder, &view, &depth_view, &draw);
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(height),
                },
            },
            size,
        );
        self.queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        readback.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(std::time::Duration::from_secs(10)),
            })
            .map_err(|e| RenderError::Device(e.to_string()))?;
        rx.recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| RenderError::Device(e.to_string()))?
            .map_err(|e| RenderError::Device(e.to_string()))?;
        let mapped = readback
            .slice(..)
            .get_mapped_range()
            .map_err(|e| RenderError::Device(e.to_string()))?;
        let mut pixels = Vec::with_capacity((width * height * 4) as usize);
        for line in mapped.chunks(row as usize) {
            pixels.extend_from_slice(&line[..(width * 4) as usize]);
        }
        drop(mapped);
        readback.unmap();
        Ok(pixels)
    }
    fn upload_texture(&self, data: &TextureData) -> wgpu::Texture {
        let size = wgpu::Extent3d {
            width: data.width(),
            height: data.height(),
            depth_or_array_layers: 1,
        };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("frame material texture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: match data.color_space() {
                ColorSpace::Linear => wgpu::TextureFormat::Rgba8Unorm,
                ColorSpace::Srgb => wgpu::TextureFormat::Rgba8UnormSrgb,
            },
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            data.rgba8(),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(data.width() * 4),
                rows_per_image: Some(data.height()),
            },
            size,
        );
        texture
    }
    fn bind_texture(&self, texture: &wgpu::Texture, sampling: Sampling) -> wgpu::BindGroup {
        let filter = match sampling.filter {
            TextureFilter::Nearest => wgpu::FilterMode::Nearest,
            TextureFilter::Linear => wgpu::FilterMode::Linear,
        };
        let address = match sampling.address {
            TextureAddress::Clamp => wgpu::AddressMode::ClampToEdge,
            TextureAddress::Repeat => wgpu::AddressMode::Repeat,
        };
        let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: filter,
            min_filter: filter,
            address_mode_u: address,
            address_mode_v: address,
            ..Default::default()
        });
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("frame material binding"),
            layout: &self.material_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(
                        &texture.create_view(&Default::default()),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        })
    }
    fn material_binding(
        &self,
        material: &DrawMaterial,
        assets: &[&Arc<TextureData>],
        textures: &[wgpu::Texture],
        bindings: &mut Vec<wgpu::BindGroup>,
    ) -> usize {
        let Some(texture) = &material.texture else {
            return 0;
        };
        let index = assets
            .iter()
            .position(|asset| Arc::ptr_eq(asset, texture))
            .expect("collected frame texture")
            + 1;
        let binding = bindings.len();
        bindings.push(self.bind_texture(&textures[index], material.sampling));
        binding
    }
}

fn texture_assets(frame: &PreparedFrame) -> Vec<&Arc<TextureData>> {
    let mut assets: Vec<&Arc<TextureData>> = Vec::new();
    for material in frame
        .spheres
        .iter()
        .map(|s| &s.material)
        .chain(frame.meshes.iter().map(|m| &m.material))
    {
        if let Some(texture) = &material.texture {
            if !assets.iter().any(|other| Arc::ptr_eq(other, texture)) {
                assets.push(texture);
            }
        }
    }
    assets
}
fn pack_vertex(
    data: &mut Vec<u8>,
    clip: [f32; 4],
    normal: [f32; 3],
    uv: [f32; 2],
    material: &DrawMaterial,
) -> Result<(), RenderError> {
    if !material
        .base_color
        .iter()
        .all(|c| c.is_finite() && (0.0..=1.0).contains(c))
        || !uv.iter().all(|v| v.is_finite())
        || !material.alpha.is_finite()
        || !(0.0..=1.0).contains(&material.alpha)
    {
        return Err(RenderError::InvalidFrame);
    }
    for v in clip
        .into_iter()
        .chain(normal)
        .chain(material.base_color)
        .chain(uv)
        .chain([if material.unlit { 1.0 } else { 0.0 }])
        .chain([material.alpha])
    {
        data.extend_from_slice(&v.to_le_bytes());
    }
    Ok(())
}

struct GpuFrame {
    buffer: wgpu::Buffer,
    bindings: Vec<wgpu::BindGroup>,
    batches: Vec<(std::ops::Range<u32>, usize)>,
    transparent_batches: Vec<(std::ops::Range<u32>, usize)>,
    line_batches: Vec<(std::ops::Range<u32>, usize)>,
}
#[cfg(target_arch = "wasm32")]
mod surface;
#[cfg(target_arch = "wasm32")]
pub use surface::BrowserSurface;

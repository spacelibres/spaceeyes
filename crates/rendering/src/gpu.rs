// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Native offscreen opaque marker and sphere renderer. No mutable Scene/Time access.
use crate::{mesh, PreparedFrame, RenderError};
use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::ResourceManager;
use wgpu::util::DeviceExt;

pub struct GpuRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
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
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("SpaceEyes opaque geometry"),
            source: wgpu::ShaderSource::Wgsl(include_str!("opaque.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("SpaceEyes depth-tested opaque pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 40,
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
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Ok(Self {
            device,
            queue,
            pipeline,
            adapter_name,
        })
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
        let vertices = marker_vertices
            .checked_add(sphere_vertices)
            .and_then(|n| n.checked_add(mesh_vertices))
            .ok_or(RenderError::Budget)?;
        let vertex_bytes = u64::from(vertices.max(1)) * 40;
        if vertex_bytes > self.device.limits().max_buffer_size {
            return Err(RenderError::Budget);
        }
        let reserve = bytes
            .checked_add(u64::from(width) * u64::from(height) * 8)
            .and_then(|n| n.checked_add(vertex_bytes))
            .ok_or(RenderError::Budget)?;
        let id = ResourceId::new("spaceeyes:gpu:offscreen-scratch").expect("static ID");
        resources
            .register(id.clone(), reserve)
            .map_err(|_| RenderError::Budget)?;
        let outcome = self.render_inner(frame, width, height, row, bytes, vertices);
        resources.unregister(&id).map_err(|_| RenderError::Budget)?;
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
        let mut data = Vec::with_capacity(vertices as usize * 40);
        let mut append = |clip: [f32; 4], normal: [f32; 3], color: [f32; 3]| {
            for v in clip.into_iter().chain(normal).chain(color) {
                data.extend_from_slice(&v.to_le_bytes());
            }
        };
        for marker in &frame.markers {
            if !marker.ndc.iter().all(|v| v.is_finite()) {
                return Err(RenderError::InvalidFrame);
            }
            for [dx, dy] in [[-0.035, -0.035], [0.035, -0.035], [0.0, 0.035]] {
                append(
                    [marker.ndc[0] + dx, marker.ndc[1] + dy, marker.ndc[2], 1.0],
                    [0.0; 3],
                    [1.0, 0.5, 0.0],
                );
            }
        }
        if !frame.spheres.is_empty() {
            let mesh = mesh::unit_sphere(mesh::SPHERE_SLICES, mesh::SPHERE_STACKS)?;
            for sphere in &frame.spheres {
                if !sphere.radius_m.is_finite()
                    || sphere.radius_m <= 0.0
                    || !sphere
                        .base_color
                        .iter()
                        .all(|c| c.is_finite() && (0.0..=1.0).contains(c))
                {
                    return Err(RenderError::InvalidFrame);
                }
                for &index in &mesh.indices {
                    let vertex = mesh.vertices[index as usize];
                    let position = std::array::from_fn(|axis| {
                        sphere.center_camera[axis]
                            + f64::from(vertex.position[axis]) * sphere.radius_m
                    });
                    append(
                        frame.projection.clip(position)?,
                        vertex.normal,
                        sphere.base_color,
                    );
                }
            }
        }
        for draw in &frame.meshes {
            if !draw
                .base_color
                .iter()
                .all(|c| c.is_finite() && (0.0..=1.0).contains(c))
            {
                return Err(RenderError::InvalidFrame);
            }
            let rotation = spaceeyes_spatial::RigidTransform::new(
                spaceeyes_spatial::Vec3d::ZERO,
                draw.object_to_camera.rotation,
            )
            .map_err(|_| RenderError::InvalidFrame)?;
            for &index in draw.geometry.indices() {
                let [x, y, z] = draw.geometry.vertices()[index as usize].normal();
                let normal = rotation.apply(spaceeyes_spatial::Vec3d { x, y, z });
                append(
                    frame.projection.clip(draw.point(index))?,
                    [normal.x as f32, normal.y as f32, normal.z as f32],
                    draw.base_color,
                );
            }
        }
        if data.is_empty() {
            data.resize(40, 0);
        }
        let buffer = self
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("opaque vertices"),
                contents: &data,
                usage: wgpu::BufferUsages::VERTEX,
            });
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
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_vertex_buffer(0, buffer.slice(..));
            pass.draw(0..vertices, 0..1);
        }
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
}

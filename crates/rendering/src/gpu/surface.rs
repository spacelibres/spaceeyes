// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! One in-flight browser frame; no blocking GPU wait or second resource registry.
use super::*;
use crate::{MAX_CANVAS_DIMENSION, SURFACE_CAPACITY_BYTES};
pub struct BrowserSurface {
    renderer: GpuRenderer,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    view_format: wgpu::TextureFormat,
    _instance: wgpu::Instance,
    lost: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}
impl BrowserSurface {
    pub async fn new(canvas: web_sys::HtmlCanvasElement) -> Result<Self, RenderError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| RenderError::Device(e.to_string()))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            })
            .await
            .map_err(|_| RenderError::NoAdapter)?;
        let config = surface
            .get_default_config(&adapter, 1, 1)
            .ok_or(RenderError::NoAdapter)?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| RenderError::Device(e.to_string()))?;
        let lost = std::sync::Arc::new(std::sync::Mutex::new(None));
        let lost_signal = lost.clone();
        device.set_device_lost_callback(move |reason, message| {
            if let Ok(mut state) = lost_signal.lock() {
                *state = Some(format!("GPU device lost: {reason:?}: {message}"));
            }
        });
        let view_format = config.format.add_srgb_suffix();
        let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let renderer = GpuRenderer::from_device(device, queue, view_format);
        if let Some(error) = scope.pop().await {
            renderer.device.destroy();
            return Err(RenderError::Device(error.to_string()));
        }
        Ok(Self {
            renderer,
            surface,
            config,
            view_format,
            _instance: instance,
            lost,
        })
    }
    pub async fn render(
        &mut self,
        frame: &PreparedFrame,
        width: u32,
        height: u32,
        resources: &mut ResourceManager,
    ) -> Result<(), RenderError> {
        if width == 0
            || height == 0
            || width > MAX_CANVAS_DIMENSION
            || height > MAX_CANVAS_DIMENSION
        {
            return Err(RenderError::InvalidFrame);
        }
        if let Some(error) = self
            .lost
            .lock()
            .map_err(|_| RenderError::Device("device state unavailable".into()))?
            .clone()
        {
            return Err(RenderError::Device(error));
        }
        let (vertices, gpu_bytes, staging_bytes) = self.renderer.frame_budget(frame)?;
        let id = ResourceId::new("spaceeyes:gpu:surface-frame").expect("static ID");
        let staging_id = ResourceId::new("spaceeyes:staging:surface-frame").expect("static ID");
        let reservation = resources
            .reserve_frame(id, gpu_bytes, staging_id, staging_bytes)
            .map_err(|_| RenderError::Budget)?;
        let validation = self
            .renderer
            .device
            .push_error_scope(wgpu::ErrorFilter::Validation);
        let allocation = self
            .renderer
            .device
            .push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let result = self.render_inner(frame, width, height, vertices).await;
        let allocation_error = allocation.pop().await;
        let validation_error = validation.pop().await;
        resources
            .release_frame(&reservation)
            .map_err(|_| RenderError::Budget)?;
        if let Some(error) = allocation_error.or(validation_error) {
            return Err(RenderError::Device(error.to_string()));
        }
        if let Some(error) = self
            .lost
            .lock()
            .map_err(|_| RenderError::Device("device state unavailable".into()))?
            .clone()
        {
            return Err(RenderError::Device(error));
        }
        result
    }
    async fn render_inner(
        &mut self,
        frame: &PreparedFrame,
        width: u32,
        height: u32,
        vertices: u32,
    ) -> Result<(), RenderError> {
        if self.config.width != width
            || self.config.height != height
            || self.config.view_formats.is_empty()
        {
            self.config.width = width;
            self.config.height = height;
            self.config.view_formats = vec![self.view_format];
            self.config.desired_maximum_frame_latency = 2;
            self.surface.configure(&self.renderer.device, &self.config);
        }
        let output = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture)
            | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            error => return Err(RenderError::Device(format!("surface: {error:?}"))),
        };
        let view = output.texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(self.view_format),
            ..Default::default()
        });
        let depth = self
            .renderer
            .device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("canvas depth"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Depth32Float,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
        let draw = self.renderer.upload_frame(frame, vertices)?;
        let mut encoder = self
            .renderer
            .device
            .create_command_encoder(&Default::default());
        self.renderer.encode_frame(
            &mut encoder,
            &view,
            &depth.create_view(&Default::default()),
            &draw,
        );
        self.renderer.queue.submit([encoder.finish()]);
        self.renderer.queue.present(output);
        let (tx, rx) = futures_channel::oneshot::channel();
        self.renderer.queue.on_submitted_work_done(move || {
            let _ = tx.send(());
        });
        rx.await
            .map_err(|_| RenderError::Device("GPU completion cancelled".into()))?;
        // Keep submitted handles and their budget alive until the GPU finishes.
        drop(draw);
        drop(depth);
        Ok(())
    }
    pub fn capacity_bytes() -> u64 {
        SURFACE_CAPACITY_BYTES
    }
}

impl Drop for BrowserSurface {
    fn drop(&mut self) {
        self.renderer.device.destroy();
    }
}

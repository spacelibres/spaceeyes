//! Pixel-width NASA lines: additive radiance, depth testing without depth writes.
use bevy::{
    asset::RenderAssetUsages, camera::visibility::NoFrustumCulling, mesh::Indices, prelude::*,
    render::render_resource::*, shader::ShaderRef,
};
// Parsed natural orbits and input history have independent existing budgets.
const MAX_SEGMENTS: usize = 92_160 + 16_384;
fn line_blend() -> BlendState {
    BlendState {
        color: BlendComponent {
            src_factor: BlendFactor::SrcAlpha,
            dst_factor: BlendFactor::One,
            operation: BlendOperation::Add,
        },
        alpha: BlendComponent {
            src_factor: BlendFactor::Zero,
            dst_factor: BlendFactor::One,
            operation: BlendOperation::Add,
        },
    }
}
fn configure_pipeline(descriptor: &mut RenderPipelineDescriptor) {
    descriptor.primitive.cull_mode = None;
    if let Some(depth) = descriptor.depth_stencil.as_mut() {
        depth.depth_write_enabled = Some(false);
    }
    if let Some(fragment) = descriptor.fragment.as_mut() {
        for target in fragment.targets.iter_mut().flatten() {
            target.blend = Some(line_blend());
        }
    }
}
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct TrajectoryMaterial {
    #[uniform(0)]
    unused: Vec4,
}
impl Material for TrajectoryMaterial {
    fn vertex_shader() -> ShaderRef {
        "shaders/trajectory.wgsl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "shaders/trajectory.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Blend
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &bevy::pbr::MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        layout: &bevy::mesh::MeshVertexBufferLayoutRef,
        _key: bevy::pbr::MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        descriptor.vertex.buffers = vec![layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_NORMAL.at_shader_location(1),
            Mesh::ATTRIBUTE_UV_0.at_shader_location(2),
            Mesh::ATTRIBUTE_COLOR.at_shader_location(3),
            Mesh::ATTRIBUTE_UV_1.at_shader_location(4),
        ])?];
        configure_pipeline(descriptor);
        Ok(())
    }
}
struct Segment {
    a: Vec3,
    b: Vec3,
    colors: [[f32; 4]; 2],
    widths: [f32; 2],
}
#[derive(Resource, Default)]
pub(crate) struct TrajectoryBatch {
    segments: Vec<Segment>,
    mesh: Option<Handle<Mesh>>,
    entity: Option<Entity>,
}
pub(crate) fn color(rgb: [f32; 4], alpha: f32) -> Color {
    Color::linear_rgba(rgb[0], rgb[1], rgb[2], alpha)
}
pub(crate) fn opacity(id: &str, hovered: bool) -> f32 {
    if hovered {
        1.
    } else if matches!(
        id,
        "mercury" | "venus" | "earth" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune"
    ) {
        0.75
    } else {
        0.35
    }
}
pub(crate) fn widths(trail: bool, hovered: bool, progress: [f32; 2]) -> [f32; 2] {
    if !trail {
        return [if hovered { 2. } else { 1.2 }; 2];
    }
    progress.map(|v| {
        if hovered {
            2. + 2. * v.clamp(0., 1.)
        } else {
            2. * v.clamp(0., 1.)
        }
    })
}
impl TrajectoryBatch {
    pub(crate) fn clear(&mut self) {
        self.segments.clear();
    }
    pub(crate) fn line(&mut self, a: Vec3, b: Vec3, ca: Color, cb: Color, widths: [f32; 2]) {
        if self.segments.len() >= MAX_SEGMENTS
            || !a.is_finite()
            || !b.is_finite()
            || a == b
            || (ca.alpha() <= 0. && cb.alpha() <= 0.)
        {
            return;
        }
        self.segments.push(Segment {
            a,
            b,
            colors: [ca.to_linear().to_f32_array(), cb.to_linear().to_f32_array()],
            widths,
        });
    }
    fn build_mesh(&self) -> Mesh {
        let mut positions = Vec::with_capacity(self.segments.len() * 4);
        let mut ends = Vec::with_capacity(positions.capacity());
        let mut uvs = Vec::with_capacity(positions.capacity());
        let mut widths = Vec::with_capacity(positions.capacity());
        let mut colors = Vec::with_capacity(positions.capacity());
        let mut indices = Vec::with_capacity(self.segments.len() * 6);
        for s in &self.segments {
            let base = positions.len() as u32;
            for (side, along) in [(-0.5, 0), (0.5, 0), (-0.5, 1), (0.5, 1)] {
                positions.push(s.a.to_array());
                ends.push(s.b.to_array());
                uvs.push([side, along as f32]);
                widths.push(s.widths);
                colors.push(s.colors[along]);
            }
            indices.extend([base, base + 1, base + 2, base + 2, base + 1, base + 3]);
        }
        Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::default(),
        )
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, ends)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uvs)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_1, widths)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colors)
        .with_inserted_indices(Indices::U32(indices))
    }
}
pub(crate) fn upload(
    mut commands: Commands,
    mut batch: ResMut<TrajectoryBatch>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<TrajectoryMaterial>>,
) {
    if batch.segments.is_empty() {
        if let Some(entity) = batch.entity {
            commands.entity(entity).insert(Visibility::Hidden);
        }
        return;
    }
    let mesh = batch.build_mesh();
    if let Some(handle) = &batch.mesh {
        if let Some(mut asset) = meshes.get_mut(handle) {
            *asset = mesh;
        }
        if let Some(entity) = batch.entity {
            commands.entity(entity).insert(Visibility::Inherited);
        }
    } else {
        let mesh = meshes.add(mesh);
        let entity = commands
            .spawn((
                Mesh3d(mesh.clone()),
                MeshMaterial3d(materials.add(TrajectoryMaterial { unused: Vec4::ZERO })),
                Transform::default(),
                NoFrustumCulling,
            ))
            .id();
        batch.mesh = Some(mesh);
        batch.entity = Some(entity);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nasa_additive_lines_do_not_punch_dark_holes_in_bright_sky() {
        let blend = line_blend();
        assert_eq!(blend.color.src_factor, BlendFactor::SrcAlpha);
        assert_eq!(blend.color.dst_factor, BlendFactor::One);
        assert_eq!(blend.color.operation, BlendOperation::Add);
        assert_eq!(blend.alpha.dst_factor, BlendFactor::One);
    }
    #[test]
    fn pipeline_preserves_planet_depth_testing_without_writing_transparent_depth() {
        let mut d = RenderPipelineDescriptor {
            depth_stencil: Some(DepthStencilState {
                format: TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(CompareFunction::GreaterEqual),
                stencil: StencilState::default(),
                bias: DepthBiasState::default(),
            }),
            fragment: Some(FragmentState {
                targets: vec![Some(ColorTargetState {
                    format: TextureFormat::Rgba16Float,
                    blend: Some(BlendState::ALPHA_BLENDING),
                    write_mask: ColorWrites::ALL,
                })],
                ..default()
            }),
            ..default()
        };
        configure_pipeline(&mut d);
        let depth = d.depth_stencil.unwrap();
        assert_eq!(depth.depth_write_enabled, Some(false));
        assert_eq!(depth.depth_compare, Some(CompareFunction::GreaterEqual));
        assert_eq!(
            d.fragment.unwrap().targets[0].as_ref().unwrap().blend,
            Some(line_blend())
        );
    }
    #[test]
    fn invisible_segments_are_not_uploaded_and_trail_taper_matches_nasa() {
        let mut b = TrajectoryBatch::default();
        b.line(Vec3::ZERO, Vec3::X, Color::NONE, Color::NONE, [1.2; 2]);
        assert!(b.segments.is_empty());
        assert_eq!(widths(false, false, [0., 1.]), [1.2; 2]);
        assert_eq!(widths(false, true, [0., 1.]), [2.; 2]);
        assert_eq!(widths(true, false, [0., 1.]), [0., 2.]);
        assert_eq!(widths(true, true, [0., 1.]), [2., 4.]);
        b.line(Vec3::ZERO, Vec3::X, Color::NONE, Color::WHITE, [0., 2.]);
        assert_eq!(b.build_mesh().count_vertices(), 4);
        assert_eq!(opacity("mars", false), 0.75);
        assert_eq!(opacity("moon", false), 0.35);
        assert_eq!(opacity("sc_iss", true), 1.);
    }
    #[test]
    fn upload_reuses_one_owned_mesh_and_material_and_hides_empty_batch() {
        let mut app = App::new();
        app.init_resource::<TrajectoryBatch>()
            .init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<TrajectoryMaterial>>()
            .add_systems(Update, upload);
        app.world_mut().resource_mut::<TrajectoryBatch>().line(
            Vec3::ZERO,
            Vec3::X,
            Color::WHITE,
            Color::WHITE,
            [1.2; 2],
        );
        app.update();
        let entity = app.world().resource::<TrajectoryBatch>().entity.unwrap();
        for _ in 0..3 {
            app.update();
        }
        assert_eq!(app.world().resource::<Assets<Mesh>>().len(), 1);
        assert_eq!(
            app.world().resource::<Assets<TrajectoryMaterial>>().len(),
            1
        );
        app.world_mut().resource_mut::<TrajectoryBatch>().clear();
        app.update();
        assert_eq!(
            *app.world().get::<Visibility>(entity).unwrap(),
            Visibility::Hidden
        );
    }
    #[test]
    fn nasa_raw_shader_rgb_reaches_vertex_buffer_without_extra_srgb_decoding() {
        let c = color([0.6, 0.4, 0.2, 1.], 0.75);
        let mut batch = TrajectoryBatch::default();
        batch.line(Vec3::ZERO, Vec3::X, c, c, [1.2; 2]);
        assert_eq!(batch.segments[0].colors[0], [0.6, 0.4, 0.2, 0.75]);
    }
}

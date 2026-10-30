use bevy::{
    prelude::*,
    render::render_resource::{AsBindGroup, Face},
    shader::ShaderRef,
};
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct StellarMaterial {
    #[uniform(0)]
    pub parameters: Vec4,
}
impl Material for StellarMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/stellar.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(
        _pipeline: &bevy::pbr::MaterialPipeline,
        _descriptor: &mut bevy::render::render_resource::RenderPipelineDescriptor,
        _layout: &bevy::mesh::MeshVertexBufferLayoutRef,
        _key: bevy::pbr::MaterialPipelineKey<Self>,
    ) -> Result<(), bevy::render::render_resource::SpecializedMeshPipelineError> {
        _descriptor.primitive.cull_mode = Some(Face::Front);
        Ok(())
    }
}

/// Surface-anchored magnetic arches, batched in one mesh per stellar representation.
pub(crate) fn prominence_mesh() -> Mesh {
    use bevy::{
        asset::RenderAssetUsages, mesh::Indices, render::render_resource::PrimitiveTopology,
    };
    let mut positions = Vec::<[f32; 3]>::new();
    let mut normals = Vec::<[f32; 3]>::new();
    let mut uvs = Vec::<[f32; 2]>::new();
    let mut indices = Vec::<u32>::new();
    for arch in 0..24 {
        let z = 1.0 - 2.0 * (arch as f32 + 0.5) / 24.;
        let angle = arch as f32 * 2.399963;
        let n = Vec3::new(
            (1. - z * z).sqrt() * angle.cos(),
            z,
            (1. - z * z).sqrt() * angle.sin(),
        );
        let tangent = n.any_orthonormal_vector();
        let binormal = n.cross(tangent);
        let spread = 0.035 + (arch % 5) as f32 * 0.013;
        let height = 0.07 + (arch % 7) as f32 * 0.025;
        for strand in 0..5 {
            let base = positions.len() as u32;
            let lane = (strand as f32 - 2.) * 0.003;
            for step in 0..=48 {
                let t = step as f32 / 48.;
                let a = (t * 2. - 1.) * spread;
                let foot = (n + tangent * a + binormal * lane).normalize();
                let center = foot * (0.998 + height * (std::f32::consts::PI * t).sin());
                let width = 0.0015 + 0.002 * (std::f32::consts::PI * t).sin();
                for side in 0..=6 {
                    let theta = side as f32 / 6. * std::f32::consts::TAU;
                    let radial = binormal * theta.cos() + foot * theta.sin();
                    positions.push((center + radial * width).to_array());
                    normals.push(radial.to_array());
                    uvs.push([
                        t,
                        side as f32 / 6. + arch as f32 * 2. + strand as f32 * 0.13,
                    ]);
                }
            }
            for step in 0..48u32 {
                for side in 0..6u32 {
                    let a = base + step * 7 + side;
                    let b = a + 7;
                    indices.extend([a, b, a + 1, a + 1, b, b + 1]);
                }
            }
        }
    }
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct ProminenceMaterial {
    #[uniform(0)]
    pub parameters: Vec4,
}
impl Material for ProminenceMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/prominence.wgsl".into()
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arches_are_bounded_surface_anchored_and_batched() {
        let mesh = prominence_mesh();
        let bevy::mesh::VertexAttributeValues::Float32x3(p) =
            mesh.attribute(Mesh::ATTRIBUTE_POSITION).unwrap()
        else {
            panic!("positions")
        };
        assert!(p.len() < 50000);
        for v in p {
            let r = Vec3::from_array(*v).length();
            assert!(r.is_finite() && (0.99..1.24).contains(&r));
        }
        for strand in p.chunks_exact(49 * 7) {
            assert!((Vec3::from_array(strand[0]).length() - 1.).abs() < 0.006);
            assert!((Vec3::from_array(strand[48 * 7]).length() - 1.).abs() < 0.006);
        }
    }
}

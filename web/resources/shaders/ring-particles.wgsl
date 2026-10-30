// Ring particles are not a solid Lambertian sheet. A view/light half-vector
// approximates the contributing particle microfacets; Bevy still supplies the
// actual incident light, PBR response, alpha handling and color processing.
// This display approximation is not a calibrated ring scattering model.
#import bevy_pbr::{
    forward_io::{VertexOutput, FragmentOutput},
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, apply_pbr_lighting, main_pass_post_lighting_processing},
    mesh_view_bindings::lights,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(100)
var<uniform> particle_response: vec4<f32>;

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr = pbr_input_from_standard_material(in, is_front);
    pbr.material.base_color = alpha_discard(pbr.material, pbr.material.base_color);
    if lights.n_directional_lights > 0u {
        let light = normalize(lights.directional_lights[0].direction_to_light);
        let half_vector = light + pbr.V;
        if dot(half_vector, half_vector) > 0.000001 {
            pbr.N = normalize(mix(pbr.N, normalize(half_vector), particle_response.x));
        }
    }
    var out: FragmentOutput;
    out.color = main_pass_post_lighting_processing(pbr, apply_pbr_lighting(pbr));
    return out;
}

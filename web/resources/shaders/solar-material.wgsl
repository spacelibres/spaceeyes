#import bevy_pbr::{
    forward_io::{VertexOutput, FragmentOutput},
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::{alpha_discard, main_pass_post_lighting_processing},
    pbr_types::STANDARD_MATERIAL_FLAGS_UNLIT_BIT,
}
#import "shaders/solar-lighting.wgsl" as solar_lighting

@group(#{MATERIAL_BIND_GROUP}) @binding(100)
var<uniform> solar_direction: vec4<f32>;

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr = pbr_input_from_standard_material(in, is_front);
    pbr.material.base_color = alpha_discard(pbr.material, pbr.material.base_color);
    var out: FragmentOutput;
    if (pbr.material.flags & STANDARD_MATERIAL_FLAGS_UNLIT_BIT) != 0u {
        out.color = pbr.material.base_color;
    } else {
        out.color = solar_lighting::corrected_lighting(pbr, solar_direction);
    }
    out.color = main_pass_post_lighting_processing(pbr, out.color);
    return out;
}

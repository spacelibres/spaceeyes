// Bevy 0.19.1 PBR adapter: reuse BRDF, maps, IBL, point fill and postprocessing.
// Only replace the single unshadowed solar directional contribution.
#import bevy_pbr::{
    pbr_types::PbrInput,
    pbr_functions::{apply_pbr_lighting, calculate_diffuse_color, calculate_F0_dielectric},
    lighting,
    mesh_view_bindings as view_bindings,
}

fn lighting_input(p: PbrInput) -> lighting::LightingInput {
    var input: lighting::LightingInput;
    let nv = max(dot(p.N, p.V), 0.0001);
    input.layers[0].NdotV = nv;
    input.layers[0].N = p.N;
    input.layers[0].R = reflect(-p.V, p.N);
    input.layers[0].perceptual_roughness = p.material.perceptual_roughness;
    input.layers[0].roughness = lighting::perceptualRoughnessToRoughness(p.material.perceptual_roughness);
    input.P = p.world_position.xyz;
    input.V = p.V;
    input.diffuse_color = calculate_diffuse_color(p.material.base_color.rgb, p.material.metallic, p.material.specular_transmission, p.material.diffuse_transmission);
    input.metallic = p.material.metallic;
    input.F0_dielectric = calculate_F0_dielectric(p.material.reflectance);
    input.F0_metallic = p.material.base_color.rgb;
    input.F_ab = lighting::F_AB(p.material.perceptual_roughness, nv);
#ifdef STANDARD_MATERIAL_CLEARCOAT
    input.layers[1].NdotV = max(dot(p.clearcoat_N, p.V), 0.0001);
    input.layers[1].N = p.clearcoat_N;
    input.layers[1].R = reflect(-p.V, p.clearcoat_N);
    input.layers[1].perceptual_roughness = p.material.clearcoat_perceptual_roughness;
    input.layers[1].roughness = lighting::perceptualRoughnessToRoughness(p.material.clearcoat_perceptual_roughness);
    input.clearcoat_strength = p.material.clearcoat;
#endif
#ifdef STANDARD_MATERIAL_ANISOTROPY
    input.anisotropy = p.anisotropy_strength;
    input.Ta = p.anisotropy_T;
    input.Ba = p.anisotropy_B;
#endif
    return input;
}

fn solar_direct(input: lighting::LightingInput, L: vec3<f32>) -> vec3<f32> {
    var i = input;
    var derived = lighting::derive_lighting_input(i.layers[0].N, i.V, L);
    let diffuse = i.diffuse_color * lighting::Fd_Burley(&i, &derived);
#ifdef STANDARD_MATERIAL_ANISOTROPY
    let specular = lighting::specular_anisotropy(&i, &derived, L, i.layers[0].roughness, 1.0);
#else
    let specular = lighting::specular(&i, &derived, i.layers[0].roughness, 1.0);
#endif
#ifdef STANDARD_MATERIAL_CLEARCOAT
    var cc = lighting::derive_lighting_input(i.layers[1].N, i.V, L);
    let f = lighting::specular_clearcoat(&i, &cc, i.clearcoat_strength, i.layers[1].roughness, 1.0);
    let inv_f = 1.0 - f.r;
    return ((diffuse + specular * inv_f) * inv_f * derived.NdotL + f.g * cc.NdotL) * view_bindings::lights.directional_lights[0].color.rgb;
#else
    return (diffuse + specular) * derived.NdotL * view_bindings::lights.directional_lights[0].color.rgb;
#endif
}

fn corrected_lighting(p: PbrInput, solar: vec4<f32>) -> vec4<f32> {
    var result = apply_pbr_lighting(p);
    if solar.w < 0.5 || view_bindings::lights.n_directional_lights == 0u { return result; }
    // Transmission is retained through Bevy, including the original solar term.
    // It is not silently approximated by the opaque single-lobe adapter.
    if p.material.diffuse_transmission > 0.0 || p.material.specular_transmission > 0.0 { return result; }
    let input = lighting_input(p);
    let old_direction = normalize(view_bindings::lights.directional_lights[0].direction_to_light);
    let delta = solar_direct(input, normalize(solar.xyz)) - solar_direct(input, old_direction);
    result = vec4<f32>(max(result.rgb + view_bindings::view.exposure * delta, vec3<f32>(0.0)), result.a);
    return result;
}

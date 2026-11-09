#import bevy_pbr::mesh_view_bindings::view
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var sky: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var sky_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var<uniform> intensity:vec4<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(3) var<uniform> tile:vec4<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(4) var<uniform> sampling:vec4<f32>;
struct Out {@builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32>}
@vertex fn vertex(@location(0) position:vec3<f32>, @location(2) uv:vec2<f32>)->Out {
 var o:Out;
 let direction=(view.view_from_world*vec4<f32>(position,0.0)).xyz;
 o.position=view.clip_from_view*vec4<f32>(direction,0.0);
 o.position.z=0.0;
 o.uv=uv;
 return o;
}
@fragment fn fragment(o:Out)->@location(0) vec4<f32> {
 let radiance=textureSample(sky,sky_sampler,sampling.xy+o.uv*sampling.zw).rgb;
 return vec4<f32>(max(radiance-vec3<f32>(intensity.y),vec3<f32>(0.0))*intensity.x,intensity.z);
}

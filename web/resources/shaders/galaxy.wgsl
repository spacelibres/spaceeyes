#import bevy_pbr::mesh_view_bindings::view
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var sky: texture_2d<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var sky_sampler: sampler;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var<uniform> intensity:vec4<f32>;
struct Out {@builtin(position) position:vec4<f32>, @location(0) direction:vec3<f32>}
@vertex fn vertex(@location(0) position:vec3<f32>)->Out {
 var o:Out;
 o.position=vec4<f32>(position.xy,0.0,1.0);
 let v=view.view_from_clip*vec4<f32>(position.xy,1.0,1.0);
 o.direction=(view.world_from_view*vec4<f32>(v.xyz,0.0)).xyz;
 return o;
}
@fragment fn fragment(o:Out)->@location(0) vec4<f32> {
 let b=normalize(o.direction); let d=vec3<f32>(b.x,-b.z,b.y);
 let uv=vec2<f32>(fract(0.5-atan2(d.y,d.x)/6.283185307),0.5-asin(clamp(d.z,-1.0,1.0))/3.141592654);
 return vec4<f32>(textureSample(sky,sky_sampler,uv).rgb*intensity.x,1.0);
}

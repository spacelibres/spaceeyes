#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::globals
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;
@fragment fn fragment(v:VertexOutput)->@location(0) vec4<f32> {
 let t=globals.time*parameters.y;
 let u=v.uv.x; let lane=v.uv.y;
 let stream=pow(0.5+0.5*sin(u*95.0-t*12.0+lane*13.0+sin(u*31.0-t*3.0)),3.0);
 let root=pow(abs(2.0*u-1.0),5.0);
 let pulse=0.65+0.35*sin(t*0.7+lane*5.0);
 let heat=clamp(root*0.8+stream*0.35,0.0,1.0);
 let color=mix(vec3<f32>(0.8,0.015,0.001),vec3<f32>(3.0,1.0,0.12),heat);
 return vec4<f32>(color*(0.2+stream)*pulse*parameters.x,0.0);
}

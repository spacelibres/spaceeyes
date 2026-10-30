#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::{globals,view}
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;
fn hash(p:vec3<f32>)->f32 {return fract(sin(dot(p,vec3<f32>(127.1,311.7,74.7)))*43758.5453);}
fn noise(p:vec3<f32>)->f32 {
 let i=floor(p);let f=fract(p);let u=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3<f32>(1,0,0)),u.x),mix(hash(i+vec3<f32>(0,1,0)),hash(i+vec3<f32>(1,1,0)),u.x),u.y),mix(mix(hash(i+vec3<f32>(0,0,1)),hash(i+vec3<f32>(1,0,1)),u.x),mix(hash(i+vec3<f32>(0,1,1)),hash(i+vec3<f32>(1,1,1)),u.x),u.y),u.z);
}
@fragment fn fragment(v:VertexOutput)->@location(0) vec4<f32> {
 let t=globals.time*parameters.y; let u=v.uv.x;let lane=v.uv.y;
 let a=noise(vec3<f32>(u*35.0-t*1.8,lane*22.0,t*0.5));
 let b=noise(vec3<f32>(u*91.0-t*4.0,lane*43.0+a*2.0,t*0.9));
 let filament=smoothstep(0.25,0.8,a*0.65+b*0.35);
 let edge=pow(abs(dot(normalize(v.world_normal),normalize(view.world_position-v.world_position.xyz))),0.65);
 let root=pow(abs(2.0*u-1.0),4.0);
 let life=0.25+0.75*smoothstep(0.15,0.8,noise(vec3<f32>(floor(lane/2.0),t*0.23,0)));
 let heat=clamp(root*0.65+filament*0.4,0.0,1.0);
 let color=mix(vec3<f32>(0.55,0.008,0.001),vec3<f32>(2.4,0.7,0.045),heat);
 return vec4<f32>(color*filament*edge*life*parameters.x,0.0);
}

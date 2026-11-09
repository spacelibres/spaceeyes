#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::{globals,view}
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;

struct Settings { data:array<vec4<f32>,19>, }
struct Profile { data:array<vec4<f32>,64>, }
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var<uniform> settings:Settings;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var<uniform> profile:Profile;
fn param(i:u32)->f32{return settings.data[min(i/4u,18u)][i%4u];}
fn rgb(i:u32)->vec3<f32>{let c=u32(param(i));return vec3<f32>(f32((c>>16u)&255u),f32((c>>8u)&255u),f32(c&255u))/255.0;}
fn hash(p:vec3<f32>)->f32 {return fract(sin(dot(p,vec3<f32>(127.1,311.7,74.7)))*43758.5453);}
fn noise(p:vec3<f32>)->f32 {
 let i=floor(p);let f=fract(p);let u=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3<f32>(1,0,0)),u.x),mix(hash(i+vec3<f32>(0,1,0)),hash(i+vec3<f32>(1,1,0)),u.x),u.y),mix(mix(hash(i+vec3<f32>(0,0,1)),hash(i+vec3<f32>(1,0,1)),u.x),mix(hash(i+vec3<f32>(0,1,1)),hash(i+vec3<f32>(1,1,1)),u.x),u.y),u.z);
}
@fragment fn fragment(v:VertexOutput)->@location(0) vec4<f32> {
 if(param(72u)>0.5){
  let phase=v.uv.x-parameters.z*param(67u)*param(70u);
  let structure=0.45+0.55*noise(vec3<f32>(phase/1800.0,v.uv.y*13.0,0.0));
  let edge=pow(abs(dot(normalize(v.world_normal),normalize(view.world_position-v.world_position.xyz))),param(47u));
  let alpha=(1.0-exp(-param(68u)*structure*edge))*parameters.x*param(2u);
  return vec4<f32>(mix(rgb(48u),rgb(49u),structure*0.65)*param(69u)*param(36u)*alpha,alpha);
 }
 let t=parameters.z*param(44u); let u=v.uv.x;let lane=v.uv.y;
 let a=noise(vec3<f32>(u*35.0-t*1.8,lane*22.0,t*0.5));
 let b=noise(vec3<f32>(u*91.0-t*4.0,lane*43.0+a*2.0,t*0.9));
 let filament=smoothstep(param(42u),param(43u),a*0.65+b*0.35);
 let edge=pow(abs(dot(normalize(v.world_normal),normalize(view.world_position-v.world_position.xyz))),param(47u));
 let root=pow(abs(2.0*u-1.0),4.0);
 let life=param(46u)+(1.0-param(46u))*smoothstep(0.15,0.8,noise(vec3<f32>(floor(lane/2.0),parameters.z*param(45u)*0.23,0)));
 let heat=clamp(root*0.65+filament*0.4,0.0,1.0);
 let color=mix(rgb(48u),rgb(49u),heat);
 return vec4<f32>(color*filament*edge*life*parameters.x*param(36u)*param(2u),0.0);
}

#import bevy_pbr::forward_io::VertexOutput
#import bevy_pbr::mesh_view_bindings::{globals,view}
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters: vec4<f32>;
@fragment fn fragment(v: VertexOutput) -> @location(0) vec4<f32> {
 let p=v.uv*vec2<f32>(6.2831853,3.1415927);
 let t=globals.time*parameters.y;
 let flow=0.72+0.18*sin(p.x*12.0+sin(p.y*7.0+t)*1.5-t*0.3)+0.1*sin(p.x*29.0-p.y*11.0+t*.7);
 let n=normalize(v.world_normal);
 let eye=normalize(view.world_position-v.world_position.xyz);
 let mu=abs(dot(n,eye));
 let radial=1.65*sqrt(max(1.0-mu*mu,0.0));
 let fade=1.0-smoothstep(1.15,1.65,radial);
 let glow=parameters.x*0.55*flow*exp(-max(radial-1.0,0.0)*7.0)*fade;
 return vec4<f32>(vec3<f32>(1.0,0.32,0.04)*glow,0.0);
}

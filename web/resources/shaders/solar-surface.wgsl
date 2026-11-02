#import bevy_pbr::forward_io::Vertex
#import bevy_pbr::mesh_functions
#import bevy_pbr::mesh_view_bindings::view
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;
struct Settings { data:array<vec4<f32>,19>, }
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var<uniform> settings:Settings;
fn p(i:u32)->f32{return settings.data[i/4u][i%4u];}
fn hash(v:vec3<f32>)->f32 {
 var q=fract(v*0.1031);q+=dot(q,q.yzx+33.33);
 return fract((q.x+q.y)*q.z);
}
fn noise(v:vec3<f32>)->f32 {
 let i=floor(v); let f=fract(v); let u=f*f*(3.0-2.0*f);
 let z0=mix(mix(hash(i),hash(i+vec3<f32>(1,0,0)),u.x),
            mix(hash(i+vec3<f32>(0,1,0)),hash(i+vec3<f32>(1,1,0)),u.x),u.y);
 let z1=mix(mix(hash(i+vec3<f32>(0,0,1)),hash(i+vec3<f32>(1,0,1)),u.x),
            mix(hash(i+vec3<f32>(0,1,1)),hash(i+vec3<f32>(1,1,1)),u.x),u.y);
 return mix(z0,z1,u.z);
}
struct Out { @builtin(position) clip:vec4<f32>, @location(0) local:vec3<f32>, @location(1) world_position:vec4<f32>, @location(2) world_normal:vec3<f32>, }
@vertex fn vertex(v:Vertex)->Out { let m=mesh_functions::get_world_from_local(v.instance_index); var o:Out; o.world_position=m*vec4<f32>(v.position,1.0); o.clip=view.clip_from_world*o.world_position; o.local=v.position; o.world_normal=normalize((m*vec4<f32>(v.normal,0.0)).xyz); return o; }
fn linear_color(c:vec3<f32>)->vec3<f32>{return select(c/12.92,pow((c+vec3<f32>(0.055))/1.055,vec3<f32>(2.4)),c>vec3<f32>(0.04045));}
@fragment fn fragment(v:Out)->@location(0) vec4<f32> {
 // Recover body coordinates; texture and active regions remain anchored during orbiting.

 let color=u32(p(4u));let baseline=vec3<f32>(f32((color>>16u)&255u),f32((color>>8u)&255u),f32(color&255u))/255.0;
 // Distance never changes the palette. Small distant discs cover few fragments;
 // filter only unresolved spatial detail, keeping its mean value unchanged.
 let n=normalize(v.local);
 let t=parameters.x*p(60u)*3.0;
 // Camera-independent analytic swirl guides the four bounded noise samples.
 var flow=vec3<f32>(sin(n.y*9.0+t),cos(n.z*8.0-t*0.7),sin(n.x*7.0+t*0.4));
 var activity=0.0;
 let centers=array<vec3<f32>,4>(normalize(vec3<f32>(0.6,0.4,0.7)),normalize(vec3<f32>(-0.5,-0.3,0.8)),normalize(vec3<f32>(0.3,-0.6,-0.75)),normalize(vec3<f32>(-0.7,0.5,-0.5)));
 for(var i=0u;i<4u;i++){
  let angle=max(1.0-dot(n,centers[i]),0.0);
  let local=exp(-angle/max(0.0001,0.5*p(62u)*p(62u)));
  flow+=cross(centers[i],n)*local*35.0;
  activity+=local*(0.72+0.18*sin(t*0.3+f32(i)));
 }
 let q=n*max(p(59u),0.1)+flow*0.025;
 let a=noise(q*9.0+flow*0.15);
 let b=noise(q*47.0+flow*0.55);
 let footprint=fwidth(q);
 let footprintMax=max(footprint.x,max(footprint.y,footprint.z));
 let c=mix(noise(q*173.0+flow*1.1+t*0.05),0.5,smoothstep(0.6,1.5,footprintMax*173.0));
 let d=mix(noise(q*397.0+flow*1.7-t*0.08),0.5,smoothstep(0.6,1.5,footprintMax*397.0));
 // Broad dark channels, then narrow curved ridges and fine grain; avoid uniform salt noise.
 let grain=a*0.20+b*0.25+c*0.35+d*0.20;
 let intensity=clamp((grain-0.48)*p(58u)*1.6+0.42+activity*p(61u)*0.36,0.0,1.0);

 let dark=baseline*vec3<f32>(0.32,0.14,0.08);
 let orange=mix(baseline,vec3<f32>(1.0,0.22,0.008),0.25);
 let gold=mix(baseline,vec3<f32>(1.0,0.67,0.055),0.82);
 let whitegold=vec3<f32>(1.0,0.94,0.65);
 var radiance=mix(dark,orange,smoothstep(0.06,0.48,intensity));
 radiance=mix(radiance,gold,smoothstep(0.56,0.91,intensity));
 radiance=mix(radiance,whitegold,smoothstep(0.91,1.0,intensity));
 let facing=abs(dot(normalize(v.world_normal),normalize(view.world_position-v.world_position.xyz)));
 let limb=1.0+pow(1.0-facing,5.0)*p(63u)*0.25*(0.5+grain);
 // Palette values are sRGB; the render target expects linear emission.
 let linear=linear_color(radiance);
 return vec4<f32>(linear*p(3u)*limb,1.0);
}

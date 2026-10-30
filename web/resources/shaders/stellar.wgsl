#import bevy_pbr::forward_io::Vertex
#import bevy_pbr::mesh_functions::get_world_from_local
#import bevy_pbr::mesh_view_bindings::{globals,view}
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;
struct Out {
 @builtin(position) clip:vec4<f32>,
 @location(0) p:vec3<f32>,
 @location(1) @interpolate(flat) eye:vec3<f32>,
}
fn hash(p:vec3<f32>)->f32 { return fract(sin(dot(p,vec3<f32>(127.1,311.7,74.7)))*43758.5453); }
fn noise(p:vec3<f32>)->f32 {
 let i=floor(p); let f=fract(p); let u=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3<f32>(1,0,0)),u.x),mix(hash(i+vec3<f32>(0,1,0)),hash(i+vec3<f32>(1,1,0)),u.x),u.y),mix(mix(hash(i+vec3<f32>(0,0,1)),hash(i+vec3<f32>(1,0,1)),u.x),mix(hash(i+vec3<f32>(0,1,1)),hash(i+vec3<f32>(1,1,1)),u.x),u.y),u.z);
}
fn fbm(p:vec3<f32>)->f32 { return noise(p)*0.57+noise(p*2.03+7.1)*0.28+noise(p*4.11-3.7)*0.15; }
@vertex fn vertex(v:Vertex)->Out {
 let model=get_world_from_local(v.instance_index);
 let center=model[3].xyz;
 let world=model*vec4<f32>(v.position,1.0);
 let radius=length(model[0].xyz)/2.8;
 var o:Out; o.clip=view.clip_from_world*world;
 o.p=(world.xyz-center)/radius; o.eye=(view.world_position-center)/radius;
 return o;
}
@fragment fn fragment(v:Out)->@location(0) vec4<f32> {
 let ray=normalize(v.p-v.eye);
 let b=dot(v.eye,ray); let c=dot(v.eye,v.eye)-7.84;
 let h=sqrt(max(b*b-c,0.0));
 let start=max(-b-h,0.0); let end=-b+h;
 let step=(end-start)/32.0;
 // Physical transport uses Parker flight time. 3600 model seconds per visual second;
 // flowSpeed=0 freezes the visualization. This is explicitly time-compressed.
 let model_time=globals.time*3600.0*parameters.y;
 let t=globals.time*parameters.y;
 var light=vec3<f32>(0.0);
 for(var j=0;j<32;j=j+1) {
  let p=v.eye+ray*(start+(f32(j)+0.5)*step);
  let r=length(p); let height=r-1.0;
  if(height>0.0 && height<1.78) {
   let physical=solar_wind_state(r);
   let advected=(model_time-physical.y)/3600.0;
   let dir=p/r;
   let warp=vec3<f32>(fbm(dir*7.0+vec3<f32>(t*0.3,0,0)),fbm(dir*7.0+11.0),fbm(dir*7.0-9.0));
   let stream=fbm(dir*32.0+warp*3.0-vec3<f32>(0,height*35.0-t*2.0,0));
   let reach=0.10+0.9*pow(fbm(dir*9.0+warp+vec3<f32>(0,t*0.16,0)),2.0);
   let flame=(1.0-smoothstep(reach*0.4,reach,height))*smoothstep(0.42,0.78,stream);
   let base=0.045*exp(-height*9.0);
   let channels=smoothstep(0.53,0.77,fbm(dir*11.0+warp*2.0+vec3<f32>(0,t*0.13,0)));
   let parcels=smoothstep(0.38,0.72,fbm(dir*19.0+warp*3.0+vec3<f32>(advected*2.2,advected,0)));
   // Relative n_e squared emissivity, then an explicit fourth-root display enhancement.
   let relative_emission=physical.x*physical.x;
   let wind=channels*parcels*0.35*pow(relative_emission,0.25)*(1.0-smoothstep(1.3,1.78,height));
   let density=(flame+base+wind)*step*parameters.x*2.5;
   let heat=clamp(flame*0.65+exp(-height*35.0)*0.5,0.0,1.0);
   light+=mix(vec3<f32>(0.7,0.012,0.001),vec3<f32>(2.0,0.65,0.06),heat)*density;
  }
 }
 return vec4<f32>(light,0.0);
}

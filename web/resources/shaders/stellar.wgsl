#import bevy_pbr::forward_io::Vertex
#import bevy_pbr::mesh_functions::get_world_from_local
#import bevy_pbr::mesh_view_bindings::{globals,view}
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;

struct Settings { data:array<vec4<f32>,15>, }
struct Profile { data:array<vec4<f32>,64>, }
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var<uniform> settings:Settings;
@group(#{MATERIAL_BIND_GROUP}) @binding(2) var<uniform> profile:Profile;
fn param(i:u32)->f32{return settings.data[min(i/4u,14u)][i%4u];}
fn rgb(i:u32)->vec3<f32>{let c=u32(param(i));return vec3<f32>(f32((c>>16u)&255u),f32((c>>8u)&255u),f32(c&255u))/255.0;}
fn tuned_wind(r:f32)->vec2<f32>{if(profile.data[0].z<0.5){return solar_wind_state(r);}let x=clamp(log(r)/log(12.0)*63.0,0.0,63.0);let a=u32(floor(x));let b=min(a+1u,63u);return mix(profile.data[a].xy,profile.data[b].xy,fract(x));}
struct Out {
 @builtin(position) clip:vec4<f32>,
 @location(0) p:vec3<f32>,
 @location(1) @interpolate(flat) eye:vec3<f32>,
 @location(2) @interpolate(flat) center_radius:vec4<f32>,
}
fn hash(p:vec3<f32>)->f32 {
 var q=fract(p*0.1031);q+=dot(q,q.yzx+33.33);
 return fract((q.x+q.y)*q.z);
}
fn noise(p:vec3<f32>)->f32 {
 let i=floor(p); let f=fract(p); let u=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3<f32>(1,0,0)),u.x),mix(hash(i+vec3<f32>(0,1,0)),hash(i+vec3<f32>(1,1,0)),u.x),u.y),mix(mix(hash(i+vec3<f32>(0,0,1)),hash(i+vec3<f32>(1,0,1)),u.x),mix(hash(i+vec3<f32>(0,1,1)),hash(i+vec3<f32>(1,1,1)),u.x),u.y),u.z);
}
@vertex fn vertex(v:Vertex)->Out {
 let model=get_world_from_local(v.instance_index);
 let center=model[3].xyz;
 let world=model*vec4<f32>(v.position,1.0);
 let radius=length(model[0].xyz)/param(13u);
 var o:Out; o.clip=view.clip_from_world*world;
 o.p=(world.xyz-center)/radius; o.eye=(view.world_position-center)/radius;
 o.center_radius=vec4<f32>(center,radius);
 return o;
}
struct PlasmaOutput {
 @location(0) color:vec4<f32>,
 @builtin(frag_depth) depth:f32,
}
@fragment fn fragment(v:Out)->PlasmaOutput {
 let ray=normalize(v.p-v.eye);
 let b=dot(v.eye,ray); let c=dot(v.eye,v.eye)-param(13u)*param(13u);
 let h=sqrt(max(b*b-c,0.0));
 let start=max(-b-h,0.0); var end=-b+h;
 // Integrate the foreground corona, stopping at the opaque solar surface.
 // The rasterized back shell is only a proxy, never the depth of the volume.
 let surface_discriminant=b*b-dot(v.eye,v.eye)+1.0;
 if(surface_discriminant>=0.0 && param(0u)>0.5) {
  let surface_hit=-b-sqrt(surface_discriminant);
  if(surface_hit>=0.0) { end=min(end,surface_hit); }
 }
 if(end<=start) {discard;}
 let extent=end-start;
 // Physical transport uses Parker flight time. 3600 model seconds per visual second;
 // flowSpeed=0 freezes the visualization. This is explicitly time-compressed.
 let model_time=parameters.z*param(6u);
 let t=parameters.z;
 var light=vec3<f32>(0.0);
 var transmission=1.0;
 // Hard per-fragment budget: 4..24 samples, at most four noise calls per sample.
 for(var j=0;j<i32(param(52u));j=j+1) {
  if(transmission<param(53u)) {break;}
  let u0=f32(j)/param(52u); let u1=f32(j+1)/param(52u);
  // Bias integration toward the solar surface without a screen-space expansion.
  let a=1.0-(1.0-u0)*(1.0-u0); let z=1.0-(1.0-u1)*(1.0-u1);
  let step=extent*(z-a);
  // Fixed spatial jitter avoids coherent bands without time-dependent flicker.
  let jitter=0.5-param(54u)*0.5+param(54u)*hash(vec3<f32>(v.clip.xy,f32(j)));
  let p=v.eye+ray*(start+extent*mix(a,z,jitter));
  let r=length(p); let height=r-1.0;
  if(height>0.0 && r<param(13u)) {
   let physical=tuned_wind(r);
   let dir=p/r;
   var flame=0.0;
   if(height<param(25u)+param(26u)) {
    let warp=noise(dir*param(29u)+vec3<f32>(t*0.3,0,0));
    let stream=noise(dir*param(30u)+warp*param(33u)-vec3<f32>(0,height*param(35u)-t*param(34u),0));
    let reach=max(0.0001,param(25u)+param(26u)*warp*warp);
    flame=(1.0-smoothstep(reach*0.4,reach,height))*smoothstep(param(31u),param(32u),stream);
   }
   let base=param(27u)*exp(-height*param(28u));
   let channels=smoothstep(param(18u),param(19u),noise(dir*param(17u)));
   // A 3D Cartesian material field pulled back along radial Parker characteristics.
   // At fixed material label, increasing time means increasing radius, in all directions.
   let flight_span=select(WIND_TRAVEL[63],profile.data[63].y,profile.data[0].z>0.5);
   let phase=fract((physical.y-model_time)/flight_span);
   let material_point=dir*(1.0+11.0*phase);
   let parcel_noise=noise(material_point*param(20u));
   let parcels=smoothstep(param(21u),param(22u),parcel_noise)*smoothstep(0.0,param(23u),phase)*(1.0-smoothstep(1.0-param(23u),1.0,phase));
   // Relative n_e squared emissivity, then an explicit power-law display enhancement.
   let relative_emission=physical.x*physical.x*pow(param(51u)/5.0,2.0);
   let wind=channels*parcels*param(9u)*pow(relative_emission,param(10u))*(1.0-smoothstep(param(14u),param(13u),r));
   let density=(flame*param(24u)+base+wind)*step*parameters.x*param(8u)*param(12u)*param(1u);
   let heat=clamp(flame*0.65+exp(-height*35.0)*0.5,0.0,1.0);
   // Front-to-back, premultiplied emission / display extinction.
   let alpha=1.0-exp(-density*param(11u));
   let emission=mix(rgb(15u),rgb(16u),heat);
   light+=transmission*emission*alpha;
   transmission*=1.0-alpha;
  }
 }
 var out:PlasmaOutput;
 out.color=vec4<f32>(light,1.0-transmission);
 let entry_world=v.center_radius.xyz+(v.eye+ray*start)*v.center_radius.w;
 let entry_clip=view.clip_from_world*vec4<f32>(entry_world,1.0);
 // Bevy uses reverse Z: an observer inside the volume starts at near depth.
 out.depth=1.0;
 if(start>0.000001 && entry_clip.w>0.0) {out.depth=clamp(entry_clip.z/entry_clip.w,0.0,1.0);}
 return out;
}

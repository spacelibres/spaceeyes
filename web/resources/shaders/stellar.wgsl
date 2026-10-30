#import bevy_pbr::forward_io::Vertex
#import bevy_pbr::mesh_functions::get_world_from_local
#import bevy_pbr::mesh_view_bindings::{globals,view}
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> parameters:vec4<f32>;
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
 let radius=length(model[0].xyz)/12.0;
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
 let b=dot(v.eye,ray); let c=dot(v.eye,v.eye)-144.0;
 let h=sqrt(max(b*b-c,0.0));
 let start=max(-b-h,0.0); var end=-b+h;
 // Integrate the foreground corona, stopping at the opaque solar surface.
 // The rasterized back shell is only a proxy, never the depth of the volume.
 let surface_discriminant=b*b-dot(v.eye,v.eye)+1.0;
 if(surface_discriminant>=0.0) {
  let surface_hit=-b-sqrt(surface_discriminant);
  if(surface_hit>=0.0) { end=min(end,surface_hit); }
 }
 if(end<=start) {discard;}
 let extent=end-start;
 // Physical transport uses Parker flight time. 3600 model seconds per visual second;
 // flowSpeed=0 freezes the visualization. This is explicitly time-compressed.
 let model_time=globals.time*3600.0*parameters.y;
 let t=globals.time*parameters.y;
 var light=vec3<f32>(0.0);
 var transmission=1.0;
 // Hard per-fragment budget: twelve samples, at most four noise calls per sample.
 for(var j=0;j<12;j=j+1) {
  if(transmission<0.02) {break;}
  let u0=f32(j)/12.0; let u1=f32(j+1)/12.0;
  // Bias integration toward the solar surface without a screen-space expansion.
  let a=1.0-(1.0-u0)*(1.0-u0); let z=1.0-(1.0-u1)*(1.0-u1);
  let step=extent*(z-a);
  // Fixed spatial jitter avoids coherent bands without time-dependent flicker.
  let jitter=0.45+0.1*hash(vec3<f32>(v.clip.xy,f32(j)));
  let p=v.eye+ray*(start+extent*mix(a,z,jitter));
  let r=length(p); let height=r-1.0;
  if(height>0.0 && height<10.99) {
   let physical=solar_wind_state(r);
   let dir=p/r;
   var flame=0.0;
   if(height<0.8) {
    let warp=noise(dir*7.0+vec3<f32>(t*0.3,0,0));
    let stream=noise(dir*32.0+warp*3.0-vec3<f32>(0,height*35.0-t*2.0,0));
    let reach=0.10+0.7*warp*warp;
    flame=(1.0-smoothstep(reach*0.4,reach,height))*smoothstep(0.42,0.78,stream);
   }
   let base=0.045*exp(-height*9.0);
   let channels=smoothstep(0.40,0.78,noise(dir*11.0));
   // A 3D Cartesian material field pulled back along radial Parker characteristics.
   // At fixed material label, increasing time means increasing radius, in all directions.
   let flight_span=WIND_TRAVEL[63];
   let phase=fract((physical.y-model_time)/flight_span);
   let material_point=dir*(1.0+11.0*phase);
   let parcel_noise=noise(material_point*4.0);
   let parcels=smoothstep(0.53,0.77,parcel_noise)*smoothstep(0.0,0.035,phase)*(1.0-smoothstep(0.965,1.0,phase));
   // Relative n_e squared emissivity, then an explicit power-law display enhancement.
   let relative_emission=physical.x*physical.x;
   let wind=channels*parcels*0.55*pow(relative_emission,0.30)*(1.0-smoothstep(8.0,10.99,height));
   let density=(flame*0.75+base+wind)*step*parameters.x*2.5;
   let heat=clamp(flame*0.65+exp(-height*35.0)*0.5,0.0,1.0);
   // Front-to-back, premultiplied emission / display extinction.
   let alpha=1.0-exp(-density*0.8);
   let emission=mix(vec3<f32>(0.35,0.008,0.001),vec3<f32>(2.0,0.65,0.06),heat);
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

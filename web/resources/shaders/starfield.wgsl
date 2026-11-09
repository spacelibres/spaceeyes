#import bevy_pbr::mesh_view_bindings::view
@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<uniform> observer: vec4<f32>;
@group(#{MATERIAL_BIND_GROUP}) @binding(1) var<uniform> lod: vec4<f32>;
struct Input { @location(3) source: vec2<f32>, @location(0) position: vec3<f32>, @location(2) uv: vec2<f32>, @location(5) color: vec4<f32> }
struct Output { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) color: vec4<f32> }
@vertex fn vertex(v: Input) -> Output {
 var out: Output;
 let relative=v.position-observer.xyz;
 if (v.source.y<0.5 && v.source.x>max(lod.x,lod.y)) {out.position=vec4<f32>(2.0,2.0,2.0,1.0);out.uv=v.uv;out.color=vec4<f32>(0.0);return out;}
 if (dot(relative,relative)<=1e-30) {
  out.position=vec4<f32>(2.0,2.0,2.0,1.0);
  out.uv=v.uv;out.color=vec4<f32>(0.0);return out;
 }
 let d2=max(dot(relative,relative),1e-30);
 let t=v.color.a-log(12.566370614)-log(d2)+log(1e4);
 let bright=2.0*(max(t,0.0)+log(1.0+exp(-abs(t))));
 let particleScale=sqrt(max(view.viewport.z,view.viewport.w))/60.0;
 let size=clamp(bright*4.0*particleScale,5.0,50.0);
 var clip=view.clip_from_view*vec4<f32>((view.view_from_world*vec4<f32>(normalize(relative),0.0)).xyz,0.0);
 clip.z=0.0;
 clip=vec4<f32>(clip.xy+(v.uv-0.5)*2.0*size/view.viewport.zw*clip.w,0.0,clip.w);
 out.position=clip;out.uv=v.uv;
 let visibility=select(mix(select(0.0,1.0,v.source.x<=lod.x),select(0.0,1.0,v.source.x<=lod.y),lod.z),1.0,v.source.y>=0.5);
 out.color=vec4<f32>(v.color.rgb,lod.w*visibility*max(bright*particleScale,0.0)*clamp((sqrt(d2)-0.1)/0.9,0.0,1.0));return out;
}
@fragment fn fragment(v: Output) -> @location(0) vec4<f32> {
 let r=2.0*length(v.uv-0.5);
 let psf=(exp(-32.0*r*r)+0.08*exp(-5.0*r*r))*(1.0-smoothstep(0.8,1.0,r));
 // Bevy Add uses its premultiplied pipeline: zero alpha preserves the destination.
 return vec4<f32>(v.color.rgb*(v.color.a*psf),0.0);
}

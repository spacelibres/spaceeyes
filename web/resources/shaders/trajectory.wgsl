// NASA LineShader/TrailShader: pixel widths, additive radiance and no depth writes.
#import bevy_pbr::mesh_view_bindings::view
struct Input {
 @location(0) start:vec3<f32>, @location(1) end:vec3<f32>,
 @location(2) corner:vec2<f32>, @location(3) color:vec4<f32>, @location(4) widths:vec2<f32>
}
struct Out {
 @builtin(position) position:vec4<f32>, @location(0) color:vec4<f32>
}
fn clip_near(a:vec4<f32>, b:vec4<f32>)->vec4<f32> {
 if a.z > a.w && b.z <= b.w {
  let da=a.z-a.w; let db=b.z-b.w;
  return mix(a,b,clamp(da/(da-db),0.0,1.0));
 }
 return a;
}
@vertex fn vertex(input:Input)->Out {
 var o:Out;
 let original_a=view.clip_from_world*vec4<f32>(input.start,1.0);
 let original_b=view.clip_from_world*vec4<f32>(input.end,1.0);
 let a=clip_near(original_a,original_b); let b=clip_near(original_b,original_a);
 let viewport=view.viewport.zw;
 let sa=a.xy/max(a.w,0.000001)*viewport*0.5;
 let sb=b.xy/max(b.w,0.000001)*viewport*0.5;
 let delta=sb-sa;
 let tangent=delta/max(length(delta),0.000001);
 let normal=vec2<f32>(-tangent.y,tangent.x);
 var p=mix(a,b,input.corner.y);
 let width=max(mix(input.widths.x,input.widths.y,input.corner.y),0.0);
 // NASA uses the actual pixel width; the camera MSAA handles edge coverage.
 let raster_width=width;
 p.x+=normal.x*input.corner.x*raster_width*2.0/viewport.x*p.w;
 p.y+=normal.y*input.corner.x*raster_width*2.0/viewport.y*p.w;
 o.position=p; o.color=input.color;
 if (original_a.z>original_a.w && original_b.z>original_b.w) || length(delta)<0.000001 { o.color.a=0.0; }
 return o;
}
@fragment fn fragment(o:Out)->@location(0) vec4<f32> {
 if o.color.a<=0.0 { discard; }
 return o.color;
}

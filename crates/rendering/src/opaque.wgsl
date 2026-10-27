// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec3f,
    @location(2) uv:vec2f,
    @location(3) unlit:f32,
}
@group(0) @binding(0) var base_texture:texture_2d<f32>;
@group(0) @binding(1) var base_sampler:sampler;
@vertex fn vs_main(@location(0) clip:vec4f,@location(1) normal:vec3f,@location(2) color:vec3f,@location(3) uv:vec2f,@location(4) unlit:f32)->VertexOut {
    var output:VertexOut;
    output.position=clip;
    output.normal=normal;
    output.color=color;
    output.uv=uv;output.unlit=unlit;
    return output;
}
@fragment fn fs_main(input:VertexOut)->@location(0) vec4f {
    let texel=textureSample(base_texture,base_sampler,input.uv);
    var intensity=1.0;
    if input.unlit<0.5 && dot(input.normal,input.normal)>0.01 {
        let light=normalize(vec3f(-0.4,0.6,1.0));
        intensity=0.18+0.82*max(dot(normalize(input.normal),light),0.0);
    }
    return vec4f(input.color*texel.rgb*intensity,1.0);
}

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec3f,
}
@vertex fn vs_main(@location(0) clip:vec4f,@location(1) normal:vec3f,@location(2) color:vec3f)->VertexOut {
    var output:VertexOut;
    output.position=clip;
    output.normal=normal;
    output.color=color;
    return output;
}
@fragment fn fs_main(input:VertexOut)->@location(0) vec4f {
    var intensity=1.0;
    if dot(input.normal,input.normal)>0.01 {
        let light=normalize(vec3f(-0.4,0.6,1.0));
        intensity=0.18+0.82*max(dot(normalize(input.normal),light),0.0);
    }
    return vec4f(input.color*intensity,1.0);
}

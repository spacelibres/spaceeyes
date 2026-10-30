use bevy::{
    asset::{AssetLoader, LoadContext, RenderAssetUsages, io::Reader},
    prelude::*,
    render::render_resource::{
        Extent3d, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension,
    },
};
#[derive(Default, TypePath)]
pub(crate) struct SeHdrLoader;
fn invalid() -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid SEHDR image")
}
pub(crate) fn decode(bytes: &[u8]) -> Result<Image, std::io::Error> {
    if bytes.len() < 16 || &bytes[..8] != b"SEHDR01\0" || bytes[14..16] != [0, 0] {
        return Err(invalid());
    }
    let w = u16::from_le_bytes([bytes[8], bytes[9]]) as u32;
    let h = u16::from_le_bytes([bytes[10], bytes[11]]) as u32;
    let faces = bytes[12] as u32;
    let mips = bytes[13] as u32;
    if w == 0
        || h == 0
        || ![1, 6].contains(&faces)
        || mips == 0
        || mips > w.max(h).ilog2() + 1
        || (faces == 6 && (w != h || !w.is_power_of_two()))
        || (faces == 1 && mips != 1)
    {
        return Err(invalid());
    }
    let expected = (0..mips)
        .map(|m| (w >> m).max(1) as usize * (h >> m).max(1) as usize * faces as usize * 8)
        .sum::<usize>();
    if expected > 64 * 1024 * 1024 || bytes.len() != 16 + expected {
        return Err(invalid());
    }
    // Reject NaN/infinity and negative radiance, preserving zero and values above one.
    for pair in bytes[16..].chunks_exact(2) {
        let v = u16::from_le_bytes([pair[0], pair[1]]);
        if v & 0x7c00 == 0x7c00 || (v & 0x8000 != 0 && v & 0x7fff != 0) {
            return Err(invalid());
        }
    }
    // File is mip-major; wgpu array uploads are layer-major.
    let mut data = Vec::with_capacity(expected);
    for face in 0..faces {
        let mut offset = 16;
        for mip in 0..mips {
            let size = (w >> mip).max(1) as usize * (h >> mip).max(1) as usize * 8;
            let start = offset + face as usize * size;
            data.extend_from_slice(&bytes[start..start + size]);
            offset += size * faces as usize;
        }
    }
    let mut image = Image::new_uninit(
        Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: faces,
        },
        TextureDimension::D2,
        TextureFormat::Rgba16Float,
        RenderAssetUsages::RENDER_WORLD,
    );
    image.texture_descriptor.mip_level_count = mips;
    image.data = Some(data);
    if faces == 6 {
        image.texture_view_descriptor = Some(TextureViewDescriptor {
            dimension: Some(TextureViewDimension::Cube),
            ..default()
        });
    }
    Ok(image)
}
impl AssetLoader for SeHdrLoader {
    type Asset = Image;
    type Settings = ();
    type Error = std::io::Error;
    async fn load(
        &self,
        reader: &mut dyn Reader,
        _: &(),
        _: &mut LoadContext<'_>,
    ) -> Result<Image, Self::Error> {
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await?;
        decode(&bytes)
    }
    fn extensions(&self) -> &[&str] {
        &["sehdr"]
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn black_hdr_and_rejection() {
        let mut b = b"SEHDR01\0".to_vec();
        b.extend([1, 0, 1, 0, 1, 1, 0, 0]);
        b.extend([0, 0, 0, 0x40, 0, 0, 0, 0x3c]);
        let i = decode(&b).unwrap();
        assert_eq!(i.texture_descriptor.format, TextureFormat::Rgba16Float);
        assert_eq!(i.asset_usage, RenderAssetUsages::RENDER_WORLD);
        assert_eq!(i.data.unwrap(), b[16..]);
        b[17] = 0x7c;
        assert!(decode(&b).is_err());
    }
    #[test]
    fn cube_face_order_and_mip_upload_are_preserved() {
        let mut b = b"SEHDR01\0".to_vec();
        b.extend([2, 0, 2, 0, 6, 2, 0, 0]);
        for mip in 0..2 {
            for face in 0..6 {
                for _ in 0..if mip == 0 { 16 } else { 4 } {
                    b.extend_from_slice(&((face + 1 + mip * 8) as u16).to_le_bytes());
                }
            }
        }
        let image = decode(&b).unwrap();
        assert_eq!(image.texture_descriptor.mip_level_count, 2);
        assert_eq!(
            image.texture_view_descriptor.unwrap().dimension,
            Some(TextureViewDimension::Cube)
        );
        let data = image.data.unwrap();
        for face in 0..6 {
            let base = face * 40;
            assert_eq!(
                u16::from_le_bytes([data[base], data[base + 1]]),
                face as u16 + 1
            );
            assert_eq!(
                u16::from_le_bytes([data[base + 32], data[base + 33]]),
                face as u16 + 9
            );
        }
        b.pop();
        assert!(decode(&b).is_err());
    }
}

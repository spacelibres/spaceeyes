// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Strict little-endian DYN reader. Every length is checked before allocation or
//! slicing; a corrupt file never produces a partial `DynFile`.

use crate::{
    DynError, DynPoint, LinPoint, OrbPoint, OriPoint, PointType, PosPoint, Quat, QuatPoint, Vec3,
};

const MAX_NAME_BYTES: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GravitationalParameters {
    pub mu1: f64,
    pub mu2: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DynInterval {
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DynHeader {
    pub version: u8,
    pub point_type: PointType,
    pub number_of_digits: u8,
    pub gravitational_parameters: Option<GravitationalParameters>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DynSegment {
    pub index: usize,
    pub start_time: f64,
    /// Version 2 infers the end from the next start; the last segment is open.
    pub end_time: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DynFile {
    pub header: DynHeader,
    pub points: Vec<DynPoint>,
    pub segments: Vec<DynSegment>,
    pub interval: Option<DynInterval>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }

    fn take(&mut self, needed: usize) -> Result<&'a [u8], DynError> {
        let end = self
            .offset
            .checked_add(needed)
            .ok_or(DynError::UnexpectedEnd {
                offset: self.offset,
                needed,
                remaining: self.remaining(),
            })?;
        if end > self.bytes.len() {
            return Err(DynError::UnexpectedEnd {
                offset: self.offset,
                needed,
                remaining: self.remaining(),
            });
        }
        let slice = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, DynError> {
        Ok(self.take(1)?[0])
    }

    fn i16(&mut self) -> Result<i16, DynError> {
        let bytes = self.take(2)?;
        Ok(i16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn i32(&mut self) -> Result<i32, DynError> {
        let bytes = self.take(4)?;
        Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn f64(&mut self) -> Result<f64, DynError> {
        let bytes = self.take(8)?;
        Ok(f64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }

    fn name(&mut self) -> Result<String, DynError> {
        let mut name = String::new();
        for _ in 0..MAX_NAME_BYTES {
            let byte = self.u8()?;
            if byte == 0 {
                return Ok(name);
            }
            if byte > 0x7f {
                return Err(DynError::NonAsciiName(self.offset - 1));
            }
            name.push(char::from(byte));
        }
        Err(DynError::NameTooLong(MAX_NAME_BYTES))
    }
}

fn read_quat(reader: &mut Reader<'_>) -> Result<Quat, DynError> {
    let w = reader.f64()?;
    let x = reader.f64()?;
    let y = reader.f64()?;
    let z = reader.f64()?;
    Ok(Quat { w, x, y, z })
}

fn read_vec3(reader: &mut Reader<'_>) -> Result<Vec3, DynError> {
    Ok(Vec3 {
        x: reader.f64()?,
        y: reader.f64()?,
        z: reader.f64()?,
    })
}

fn read_point(reader: &mut Reader<'_>, point_type: PointType) -> Result<DynPoint, DynError> {
    let time = reader.f64()?;
    Ok(match point_type {
        PointType::Orb => DynPoint::Orb(OrbPoint {
            time,
            semi_major_axis: reader.f64()?,
            eccentricity: reader.f64()?,
            mean_angular_motion: reader.f64()?,
            mean_anomaly_at_epoch: reader.f64()?,
            orientation: read_quat(reader)?,
        }),
        PointType::Pos => DynPoint::Pos(PosPoint {
            time,
            position: read_vec3(reader)?,
            velocity: read_vec3(reader)?,
        }),
        PointType::Lin => DynPoint::Lin(LinPoint {
            time,
            position: read_vec3(reader)?,
        }),
        PointType::Ori => DynPoint::Ori(OriPoint {
            time,
            orientation: read_quat(reader)?,
            angular_velocity: read_vec3(reader)?,
        }),
        PointType::Quat => DynPoint::Quat(QuatPoint {
            time,
            orientation: read_quat(reader)?,
        }),
    })
}

fn read_points(
    reader: &mut Reader<'_>,
    point_type: PointType,
    count: i32,
) -> Result<Vec<DynPoint>, DynError> {
    if count < 0 {
        return Err(DynError::NegativePointCount(count));
    }
    let count = usize::try_from(count).map_err(|_| DynError::PointCountTooLarge(count))?;
    let expected = count
        .checked_mul(point_type.stride())
        .ok_or(DynError::PointCountTooLarge(i32::MAX))?;
    if reader.remaining() != expected {
        return Err(DynError::PointBlockSize {
            expected,
            found: reader.remaining(),
        });
    }
    let mut points = Vec::with_capacity(count);
    for _ in 0..count {
        points.push(read_point(reader, point_type)?);
    }
    Ok(points)
}

fn read_segments(reader: &mut Reader<'_>, version: u8) -> Result<Vec<DynSegment>, DynError> {
    let count = reader.i32()?;
    if count < 0 {
        return Err(DynError::NegativeSegmentCount(count));
    }
    let count = usize::try_from(count).map_err(|_| DynError::SegmentTableSize {
        expected: usize::MAX,
        found: reader.remaining(),
    })?;
    let per_segment = if version == 1 { 16 } else { 8 };
    let expected = count
        .checked_mul(per_segment)
        .ok_or(DynError::SegmentTableSize {
            expected: usize::MAX,
            found: reader.remaining(),
        })?;
    if reader.remaining() != expected {
        return Err(DynError::SegmentTableSize {
            expected,
            found: reader.remaining(),
        });
    }
    let mut segments = Vec::with_capacity(count);
    for index in 0..count {
        let start_time = reader.f64()?;
        let end_time = if version == 1 {
            reader.f64()?
        } else {
            f64::INFINITY
        };
        segments.push(DynSegment {
            index,
            start_time,
            end_time,
        });
    }
    if version == 2 {
        for index in 0..segments.len().saturating_sub(1) {
            segments[index].end_time = segments[index + 1].start_time;
        }
    }
    Ok(segments)
}

fn read_header(reader: &mut Reader<'_>) -> Result<DynHeader, DynError> {
    let version = reader.i16()?;
    if version != 1 && version != 2 {
        return Err(DynError::UnsupportedVersion(version));
    }
    let name = reader.name()?;
    let point_type =
        PointType::from_name(&name).ok_or_else(|| DynError::InvalidPointType(name.clone()))?;
    let number_of_digits = if version == 2 { reader.u8()? } else { 0 };
    let gravitational_parameters = if point_type == PointType::Orb {
        Some(GravitationalParameters {
            mu1: reader.f64()?,
            mu2: reader.f64()?,
        })
    } else {
        None
    };
    Ok(DynHeader {
        version: version as u8,
        point_type,
        number_of_digits,
        gravitational_parameters,
    })
}

/// Parse an inline file or an index file (index files carry no points).
pub fn parse_dyn(bytes: &[u8]) -> Result<DynFile, DynError> {
    let mut reader = Reader::new(bytes);
    let header = read_header(&mut reader)?;
    let has_points = reader.u8()?;
    match has_points {
        0 => {
            let segments = read_segments(&mut reader, header.version)?;
            Ok(DynFile {
                header,
                points: Vec::new(),
                segments,
                interval: None,
            })
        }
        1 => {
            let count = reader.i32()?;
            let points = read_points(&mut reader, header.point_type, count)?;
            let interval = points.first().map(|first| DynInterval {
                min: first.time(),
                max: points.last().map_or(first.time(), DynPoint::time),
            });
            Ok(DynFile {
                header,
                points,
                segments: Vec::new(),
                interval,
            })
        }
        flag => Err(DynError::InvalidHasPoints(flag)),
    }
}

/// Parse a continuation segment, which carries records without a file header.
pub fn parse_dyn_segment(bytes: &[u8], point_type: PointType) -> Result<Vec<DynPoint>, DynError> {
    let mut reader = Reader::new(bytes);
    let has_points = reader.u8()?;
    if has_points != 1 {
        return Err(DynError::IndexInSegment);
    }
    let count = reader.i32()?;
    read_points(&mut reader, point_type, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn point_types_have_the_documented_strides() {
        let cases = [
            (PointType::Orb, 72),
            (PointType::Pos, 56),
            (PointType::Lin, 32),
            (PointType::Ori, 64),
            (PointType::Quat, 40),
        ];
        for (point_type, stride) in cases {
            assert_eq!(point_type.stride(), stride);
            assert_eq!(PointType::from_name(point_type.name()), Some(point_type));
        }
        assert_eq!(PointType::from_name("xyz"), None);
    }
}

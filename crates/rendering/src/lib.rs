// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Read-only camera-relative rendering preparation and revision-aware picking.
use spaceeyes_foundation::{ObjectId, Revision};
use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot};
use spaceeyes_spatial::{Quatd, RigidTransform, Vec3d};
#[cfg(feature = "gpu")]
pub mod gpu;
pub mod mesh;
/// Browser prototype bounds and conservative attachment-capacity reservation.
pub const MAX_CANVAS_DIMENSION: u32 = 2048;
pub const MAX_FRAME_ELAPSED_NANOS: u64 = 250_000_000;
pub const SURFACE_CAPACITY_BYTES: u64 = 2048 * 2048 * 12;
mod sphere;
pub use sphere::{Perspective, SphereDraw};
mod triangles;
pub use triangles::MeshDraw;
mod material;
pub use material::DrawMaterial;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RenderError {
    InvalidCamera,
    CameraUnavailable,
    InvalidFrame,
    InvalidMesh,
    StalePick,
    NoAdapter,
    Device(String),
    Budget,
}
/// Ephemeral prototype view. Persistent camera state belongs to Scene commands.
#[derive(Clone, Copy, Debug)]
pub struct View {
    pub origin_m: [f64; 3],
    pub vertical_fov_radians: f64,
    pub aspect: f64,
    pub near_m: f64,
    pub far_m: f64,
}
impl View {
    pub fn validate(&self) -> Result<(), RenderError> {
        if !self.origin_m.iter().all(|v| v.is_finite())
            || ![
                self.vertical_fov_radians,
                self.aspect,
                self.near_m,
                self.far_m,
            ]
            .iter()
            .all(|v| v.is_finite())
            || self.vertical_fov_radians <= 0.0
            || self.vertical_fov_radians >= std::f64::consts::PI
            || self.aspect <= 0.0
            || self.near_m <= 0.0
            || self.far_m <= self.near_m
        {
            return Err(RenderError::InvalidCamera);
        }
        Ok(())
    }
}
#[derive(Clone, Debug)]
pub struct Marker {
    pub object: ObjectId,
    pub ndc: [f32; 3],
}
#[derive(Clone, Debug)]
pub struct PreparedFrame {
    pub sequence: u64,
    pub scene_revision: Revision,
    pub availability: FrameAvailability,
    pub markers: Vec<Marker>,
    pub spheres: Vec<SphereDraw>,
    pub meshes: Vec<MeshDraw>,
    pub projection: Perspective,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pick {
    pub object: ObjectId,
    pub scene_revision: Revision,
    pub sequence: u64,
}
impl Pick {
    pub fn validate(&self, frame: &FrameSnapshot) -> Result<(), RenderError> {
        if self.scene_revision != frame.scene.revision
            || self.sequence != frame.sequence
            || !frame.scene.objects.iter().any(|o| o.id() == &self.object)
        {
            return Err(RenderError::StalePick);
        }
        Ok(())
    }
}
pub fn prepare(frame: &FrameSnapshot, view: View) -> Result<PreparedFrame, RenderError> {
    prepare_oriented(frame, view, RigidTransform::IDENTITY)
}
/// Use a persistent camera and its pose from the same immutable frame as every object.
pub fn prepare_camera(
    frame: &FrameSnapshot,
    camera_id: &ObjectId,
    aspect: f64,
) -> Result<PreparedFrame, RenderError> {
    let object = frame
        .scene
        .objects
        .iter()
        .find(|o| o.id() == camera_id)
        .ok_or(RenderError::CameraUnavailable)?;
    let camera = object.camera().ok_or(RenderError::CameraUnavailable)?;
    let pose = frame
        .poses
        .iter()
        .find(|p| &p.object == camera_id)
        .ok_or(RenderError::CameraUnavailable)?;
    let [x, y, z] = camera.position_m();
    let [w, qx, qy, qz] = camera.orientation_wxyz();
    let local = RigidTransform::new(
        Vec3d { x, y, z },
        Quatd {
            w,
            x: qx,
            y: qy,
            z: qz,
        },
    )
    .map_err(|_| RenderError::InvalidCamera)?;
    let combined = pose.transform.after(local);
    let combined = RigidTransform::new(combined.translation_m, combined.rotation)
        .map_err(|_| RenderError::InvalidCamera)?;
    let rotation = RigidTransform::new(Vec3d::ZERO, combined.rotation)
        .map_err(|_| RenderError::InvalidCamera)?
        .inverse();
    prepare_oriented(
        frame,
        View {
            origin_m: [
                combined.translation_m.x,
                combined.translation_m.y,
                combined.translation_m.z,
            ],
            vertical_fov_radians: camera.vertical_fov_radians(),
            near_m: camera.near_m(),
            far_m: camera.far_m(),
            aspect,
        },
        rotation,
    )
}
fn prepare_oriented(
    frame: &FrameSnapshot,
    view: View,
    reference_to_camera_rotation: RigidTransform,
) -> Result<PreparedFrame, RenderError> {
    let projection = Perspective::from_view(view)?;
    let mut markers = Vec::new();
    let mut spheres = Vec::new();
    let mut meshes = Vec::new();
    for pose in &frame.poses {
        let object = frame
            .scene
            .objects
            .iter()
            .find(|o| o.id() == &pose.object)
            .ok_or(RenderError::InvalidFrame)?;
        let mut visible = object.visible();
        let mut cursor = object.parent();
        let mut remaining = frame.scene.objects.len();
        while let Some(id) = cursor {
            if remaining == 0 {
                return Err(RenderError::InvalidFrame);
            }
            remaining -= 1;
            let parent = frame
                .scene
                .objects
                .iter()
                .find(|o| o.id() == id)
                .ok_or(RenderError::InvalidFrame)?;
            visible &= parent.visible();
            cursor = parent.parent();
        }
        if !visible || object.camera().is_some() {
            continue;
        }
        let p = pose.transform.translation_m;
        let relative = reference_to_camera_rotation.apply(Vec3d {
            x: p.x - view.origin_m[0],
            y: p.y - view.origin_m[1],
            z: p.z - view.origin_m[2],
        });
        let z = -relative.z;
        if ![relative.x, relative.y, relative.z]
            .iter()
            .all(|v| v.is_finite())
        {
            return Err(RenderError::InvalidFrame);
        }
        if let Some(instance) = object.mesh() {
            let asset = frame
                .meshes
                .iter()
                .find(|asset| &asset.resource == instance.geometry())
                .ok_or(RenderError::InvalidFrame)?;
            let rotation = reference_to_camera_rotation
                .after(
                    RigidTransform::new(Vec3d::ZERO, pose.transform.rotation)
                        .map_err(|_| RenderError::InvalidFrame)?,
                )
                .rotation;
            let model =
                RigidTransform::new(relative, rotation).map_err(|_| RenderError::InvalidFrame)?;
            meshes.push(MeshDraw {
                object: object.id().clone(),
                geometry: asset.geometry.clone(),
                object_to_camera: model,
                material: DrawMaterial::prepare(
                    frame,
                    instance.base_color(),
                    instance.material().texture(),
                    instance.material().sampling(),
                    instance.material().unlit(),
                )?,
            });
            continue;
        }
        if let Some(sphere) = object.sphere() {
            if z + sphere.radius_m() >= projection.near()
                && z - sphere.radius_m() <= projection.far()
            {
                spheres.push(SphereDraw {
                    object: object.id().clone(),
                    center_camera: [relative.x, relative.y, relative.z],
                    radius_m: sphere.radius_m(),
                    material: DrawMaterial::prepare(
                        frame,
                        sphere.base_color(),
                        sphere.material().texture(),
                        sphere.material().sampling(),
                        sphere.material().unlit(),
                    )?,
                    rotation_to_camera: reference_to_camera_rotation.after(
                        RigidTransform::new(Vec3d::ZERO, pose.transform.rotation)
                            .map_err(|_| RenderError::InvalidFrame)?,
                    ),
                });
            }
            continue;
        }
        if z < view.near_m || z > view.far_m {
            continue;
        }
        let half = (view.vertical_fov_radians * 0.5).tan();
        let x = relative.x / (z * half * view.aspect);
        let y = relative.y / (z * half);
        if ![x, y, z].iter().all(|v| v.is_finite()) {
            return Err(RenderError::InvalidFrame);
        }
        if x.abs() <= 1.0 && y.abs() <= 1.0 {
            markers.push(Marker {
                object: pose.object.clone(),
                ndc: [x as f32, y as f32, projection.depth(z) as f32],
            });
        }
    }
    // Stable marker order defines equal-depth ties; the shared depth attachment resolves occlusion.
    markers.sort_by(|a, b| {
        b.ndc[2]
            .total_cmp(&a.ndc[2])
            .then(a.object.as_str().cmp(b.object.as_str()))
    });
    Ok(PreparedFrame {
        sequence: frame.sequence,
        scene_revision: frame.scene.revision,
        availability: frame.availability,
        markers,
        spheres,
        meshes,
        projection,
    })
}
impl PreparedFrame {
    /// Pick the nearest rasterized marker or sphere-mesh surface inside the clip interval.
    pub fn pick(&self, x: f32, y: f32) -> Option<Pick> {
        if !x.is_finite() || !y.is_finite() || x.abs() > 1.0 || y.abs() > 1.0 {
            return None;
        }
        let mut best: Option<(&ObjectId, f64)> = None;
        for marker in &self.markers {
            let dx = (x - marker.ndc[0]) / 0.035;
            let dy = (y - marker.ndc[1]) / 0.035;
            if (-1.0..=1.0).contains(&dy)
                && dx.abs() <= (1.0 - dy) * 0.5
                && best.is_none_or(|(_, d)| f64::from(marker.ndc[2]) <= d)
            {
                best = Some((&marker.object, f64::from(marker.ndc[2])));
            }
        }
        if !self.spheres.is_empty() {
            let mesh = mesh::unit_sphere(mesh::SPHERE_SLICES, mesh::SPHERE_STACKS).ok()?;
            for sphere in &self.spheres {
                if let Some(depth) =
                    self.projection
                        .pick_depth(sphere, f64::from(x), f64::from(y), &mesh)
                {
                    if best.is_none_or(|(_, d)| depth <= d) {
                        best = Some((&sphere.object, depth));
                    }
                }
            }
        }
        for mesh in &self.meshes {
            if let Some(depth) = mesh.pick_depth(self.projection, f64::from(x), f64::from(y)) {
                if best.is_none_or(|(_, d)| depth <= d) {
                    best = Some((&mesh.object, depth));
                }
            }
        }
        best.map(|(object, _)| Pick {
            object: object.clone(),
            sequence: self.sequence,
            scene_revision: self.scene_revision,
        })
    }
}

//! Camera collision against opt-in closed static meshes; coordinates remain body-local km.
use bevy::math::{Affine3A, DQuat, DVec3};
use bevy::mesh::Indices;
use bevy::picking::mesh_picking::ray_cast::{Backfaces, ray_mesh_intersection};
use bevy::prelude::*;

pub(crate) struct Part<'a> {
    pub mesh: &'a Mesh,
    pub transform: Affine3A,
}
pub(crate) struct Surface<'a> {
    pub center: DVec3,
    pub orientation: DQuat,
    pub radius: f64,
    pub parts: Vec<Part<'a>>,
}
impl Surface<'_> {
    fn local(&self, p: DVec3) -> DVec3 {
        let v = self.orientation.inverse() * (p - self.center);
        DVec3::new(v.x, v.z, -v.y)
    }
    fn world(&self, p: DVec3) -> DVec3 {
        self.center + self.orientation * DVec3::new(p.x, -p.z, p.y)
    }
    fn ray(&self, origin: DVec3, direction: DVec3) -> Option<(f64, DVec3, DVec3)> {
        let ray = Ray3d::new(origin.as_vec3(), Dir3::new(direction.as_vec3()).ok()?);
        self.parts
            .iter()
            .filter_map(|part| {
                let positions = part.mesh.attribute(Mesh::ATTRIBUTE_POSITION)?.as_float3()?;
                let hit = match part.mesh.indices() {
                    Some(Indices::U16(indices)) => ray_mesh_intersection(
                        ray,
                        &part.transform,
                        positions,
                        None,
                        Some(indices),
                        None,
                        Backfaces::Include,
                    ),
                    Some(Indices::U32(indices)) => ray_mesh_intersection(
                        ray,
                        &part.transform,
                        positions,
                        None,
                        Some(indices),
                        None,
                        Backfaces::Include,
                    ),
                    None => ray_mesh_intersection::<u32>(
                        ray,
                        &part.transform,
                        positions,
                        None,
                        None,
                        None,
                        Backfaces::Include,
                    ),
                }?;
                // Cross transformed edges, not the smoothed shading normal. This also
                // handles nonuniform scale correctly.
                let [a, b, c] = hit.triangle?;
                let normal = (b - a).cross(c - a).try_normalize()?;
                Some((hit.distance as f64, hit.point.as_dvec3(), normal.as_dvec3()))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
    }
    fn recover(&self, p: DVec3) -> DVec3 {
        if p.length() > self.radius {
            return p;
        }
        let dir = p.try_normalize().unwrap_or(DVec3::Z);
        // In an oriented closed surface, the first hit is an exit iff inside.
        if let Some((_, hit, normal)) = self.ray(p, dir)
            && normal.dot(dir) > 0.
        {
            return hit + normal * self.margin();
        }
        p
    }
    fn margin(&self) -> f64 {
        (self.radius * 2e-6).max(1e-6)
    }
    pub fn contains(&self, p: DVec3) -> bool {
        let p = self.local(p);
        self.recover(p).distance_squared(p) > 1e-20
    }
    pub fn constrain(&self, start: DVec3, end: DVec3) -> DVec3 {
        let mut start = self.local(start);
        let mut end = self.local(end);
        if !end.is_finite() {
            return self.world(start);
        }
        start = self.recover(start);
        end = self.recover(end);
        for _ in 0..8 {
            let delta = end - start;
            let length = delta.length();
            if length < 1e-12 {
                return self.world(start);
            }
            let direction = delta / length;
            let closest = (-start.dot(direction)).clamp(0., length);
            if (start + direction * closest).length() > self.radius {
                return self.world(end);
            }
            // Clip a distant AU-scale start to a small neighborhood in f64 before
            // converting the ray to Bevy f32. Do not lose the near-surface segment.
            let clip = (-start.dot(direction) - self.radius * 2.).clamp(0., length);
            let ray_start = start + direction * clip;
            let Some((distance, hit, normal)) = self.ray(ray_start, direction) else {
                return self.world(end);
            };
            if distance + clip >= length || normal.dot(direction) >= 0. {
                return self.world(end);
            }
            let margin = self.margin();
            let contact = start + direction * (distance + clip - margin).max(0.);
            let remaining = end - hit;
            let tangent = remaining - normal * remaining.dot(normal);
            let tangent = tangent
                .try_normalize()
                .unwrap_or_else(|| normal.any_orthonormal_vector());
            start = contact + normal * margin;
            end = start + tangent * remaining.length().min(self.radius * 0.25);
        }
        self.world(start)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn irregular_surface_does_not_push_a_lander_out_to_mean_radius() {
        let mesh = Mesh::from(Cuboid::new(4., 2., 4.));
        let surface = Surface {
            center: DVec3::ZERO,
            orientation: DQuat::IDENTITY,
            radius: 3.,
            parts: vec![Part {
                mesh: &mesh,
                transform: Affine3A::IDENTITY,
            }],
        };
        let lander = DVec3::new(0., 0., 1.01);
        assert!(surface.constrain(lander, lander).distance(lander) < 1e-9);
    }
    #[test]
    fn surface_sweep_blocks_tunneling_and_recovers_overlap() {
        let mesh = Mesh::from(Cuboid::new(4., 2., 4.));
        let surface = Surface {
            center: DVec3::ZERO,
            orientation: DQuat::IDENTITY,
            radius: 3.,
            parts: vec![Part {
                mesh: &mesh,
                transform: Affine3A::IDENTITY,
            }],
        };
        let safe = surface.constrain(DVec3::new(0., 0., 5.), DVec3::new(0., 0., -5.));
        assert!(safe.z >= 1.);
        let recovered = surface.constrain(DVec3::new(0., 0., 0.5), DVec3::new(0., 0., 0.5));
        assert!(recovered.z >= 1. && recovered.z < 1.01);
    }
    #[test]
    fn transformed_surface_is_stable_at_au_coordinates() {
        let mesh = Mesh::from(Cuboid::new(2., 2., 2.));
        let orientation = DQuat::from_rotation_x(0.7);
        let center = DVec3::new(2e8, -3e8, 1e8);
        let surface = Surface {
            center,
            orientation,
            radius: 5.,
            parts: vec![Part {
                mesh: &mesh,
                transform: Affine3A::from_scale_rotation_translation(
                    Vec3::new(2., 0.5, 3.),
                    Quat::from_rotation_y(0.3),
                    Vec3::new(0.2, 0., 0.),
                ),
            }],
        };
        let eye = center + orientation * DVec3::new(0., 0., 0.51);
        assert!(surface.constrain(eye, eye).distance(eye) < 1e-6);
        let start = center + orientation * DVec3::new(0., 0., 5.);
        let end = center + orientation * DVec3::new(0., 0., -5.);
        let safe = surface.constrain(start, end);
        assert!(!surface.contains(safe));
        assert!((orientation.inverse() * (safe - center)).z >= 0.5);
        let distant = center + orientation * DVec3::new(0., 0., 1e8);
        assert!(!surface.contains(surface.constrain(distant, end)));
    }
}

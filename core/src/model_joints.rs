use crate::{Core, CoreError, VisualSpec};
pub(crate) fn canonical_joint_name(name: &str) -> String {
    name.chars()
        .filter_map(|c| {
            if "[].:/".contains(c) {
                None
            } else if c.is_whitespace() || c == '\u{FEFF}' {
                Some('_')
            } else {
                Some(c)
            }
        })
        .collect()
}
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JointAim {
    pub joint: String,
    pub hinge_axis: [f64; 3],
    pub normal_axis: [f64; 3],
    pub target_direction_icrf: [f64; 3],
}
impl Core {
    pub fn set_model_joints(
        &mut self,
        session: &str,
        plugin: &str,
        id: &str,
        aims: Vec<JointAim>,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if self.objects.get(id).ok_or(CoreError::UnknownObject)? != session {
            return Err(CoreError::WrongOwner);
        }
        if !aims.is_empty()
            && !matches!(
                self.visuals.get(id).map(|v| &v.spec),
                Some(VisualSpec::Model { .. })
            )
        {
            return Err(CoreError::InvalidVisual);
        }
        let mut names = std::collections::HashSet::new();
        if aims.len() > 32 {
            return Err(CoreError::InvalidVisual);
        }
        for aim in &aims {
            if aim.joint.is_empty()
                || aim.joint.len() > 128
                || aim.joint.chars().any(char::is_control)
                || canonical_joint_name(&aim.joint).is_empty()
                || !names.insert(canonical_joint_name(&aim.joint))
            {
                return Err(CoreError::InvalidVisual);
            }
            for v in [
                &aim.hinge_axis,
                &aim.normal_axis,
                &aim.target_direction_icrf,
            ] {
                if v.iter().any(|x| !x.is_finite())
                    || (v.iter().map(|x| x * x).sum::<f64>() - 1.).abs() > 1e-4
                {
                    return Err(CoreError::InvalidVisual);
                }
            }
            if aim
                .hinge_axis
                .iter()
                .zip(aim.normal_axis)
                .map(|(a, b)| a * b)
                .sum::<f64>()
                .abs()
                > 1e-4
            {
                return Err(CoreError::InvalidVisual);
            }
        }
        if aims.is_empty() {
            self.model_joint_aims.remove(id);
            self.model_joint_statuses.remove(id);
        } else {
            let same_nodes = self.model_joint_aims.get(id).is_some_and(|old| {
                old.iter()
                    .map(|a| &a.joint)
                    .eq(aims.iter().map(|a| &a.joint))
            });
            self.model_joint_aims.insert(id.to_owned(), aims);
            if !same_nodes {
                self.model_joint_statuses.insert(
                    id.to_owned(),
                    serde_json::json!({"phase":"pending","applied":[],"missing":[],"ambiguous":[]}),
                );
            }
        }
        Ok(())
    }
    pub fn model_joints(&self, id: &str) -> Option<&Vec<JointAim>> {
        self.model_joint_aims.get(id)
    }
    pub fn model_joint_status(&self, id: &str) -> serde_json::Value {
        self.model_joint_statuses
            .get(id)
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    }
    #[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
    pub(crate) fn record_model_joint_status(&mut self, id: &str, status: serde_json::Value) {
        if self.model_joint_aims.contains_key(id) {
            self.model_joint_statuses.insert(id.to_owned(), status);
        }
    }
}

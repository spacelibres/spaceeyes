//! Shared value types. No dependencies on upper-level crates.
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ObjectId(String);
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct FrameId(String);
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ResourceId(String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoreError {
    EmptyIdentifier,
    DuplicateObject,
    UnknownObject,
    InvalidState,
    AlreadyStopped,
}
impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for CoreError {}

macro_rules! id_type {
    ($name:ident) => {
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, CoreError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(CoreError::EmptyIdentifier);
                }
                Ok(Self(value))
            }
            pub fn as_str(&self) -> &str { &self.0 }
        }
    };
}
id_type!(ObjectId);
id_type!(FrameId);
id_type!(ResourceId);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Revision(pub u64);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_id() {
        assert_eq!(ObjectId::new("  "), Err(CoreError::EmptyIdentifier));
    }
    #[test]
    fn ids_are_distinct_types() {
        let object = ObjectId::new("demo:earth").unwrap();
        assert_eq!(object.as_str(), "demo:earth");
    }
}

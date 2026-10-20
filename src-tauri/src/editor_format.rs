use serde_json::Value;

pub const EDITOR_VERSION: u64 = 2;

pub fn version(project: &Value) -> Result<u64, String> {
    match project.get("editor_version") {
        None => Ok(0),
        Some(value) => value.as_u64().ok_or("편집 형식 버전이 올바르지 않습니다.".into()),
    }
}

pub fn check_write(project: &Value, stored: Option<&Value>) -> Result<(), String> {
    let next = version(project)?;
    if next > EDITOR_VERSION {
        return Err("더 새로운 편집 형식입니다. 앱을 업데이트해 주세요.".into());
    }
    if let Some(previous) = stored {
        if version(previous)? > next {
            return Err("저장된 편집 형식이 더 최신입니다. 최신 작업을 다시 열어 주세요.".into());
        }
        if next >= 1 && (previous.get("source") != project.get("source")
            || previous.get("source_text") != project.get("source_text")) {
            return Err("원본 제작안은 변경할 수 없습니다. 새 프로젝트로 만들어 주세요.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retains_unknown_fields_and_blocks_older_writers() {
        let legacy = json!({"source_text":"원문", "source":{"extra":true}, "future":{"value":7}});
        let mut edited = legacy.clone();
        edited["editor_version"] = json!(1);
        assert!(check_write(&edited, Some(&legacy)).is_ok());
        let round_trip: Value = serde_json::from_slice(&serde_json::to_vec(&edited).unwrap()).unwrap();
        assert_eq!(round_trip["future"], legacy["future"]);
        assert!(check_write(&legacy, Some(&round_trip)).is_err());
        edited["source"]["extra"] = json!(false);
        assert!(check_write(&edited, Some(&round_trip)).is_err());
        edited["editor_version"] = json!(3);
        assert!(check_write(&edited, None).is_err());
    }
}

use serde_json::Value;

pub const EDITOR_VERSION: u64 = 4;

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
        if let Some(assets) = previous.pointer("/media/assets").and_then(Value::as_array) {
            for asset in assets {
                let current = project.pointer("/media/assets").and_then(Value::as_array)
                    .and_then(|items| items.iter().find(|item| item.get("id") == asset.get("id")))
                    .ok_or("보관 중인 원본 자료를 제거할 수 없습니다.")?;
                for field in ["kind", "path", "mime_type", "duration_sec", "local_store", "local_key", "storage_key", "preview_storage_key"] {
                    if (asset.get(field).is_some() || !["storage_key", "preview_storage_key"].contains(&field)) && asset.get(field) != current.get(field) {
                        return Err("보관 중인 원본 자료를 교체할 수 없습니다.".into());
                    }
                }
                if asset.get("inline_data").is_some() && current.get("storage_key").is_none() && asset.get("inline_data") != current.get("inline_data") {
                    return Err("보관 중인 원본 이미지를 교체할 수 없습니다.".into());
                }
            }
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
        edited["editor_version"] = json!(5);
        assert!(check_write(&edited, None).is_err());
    }

    #[test]
    fn retains_originals_when_scene_references_change() {
        let original = json!({"editor_version":3, "media":{"assets":[{"id":"clip", "kind":"video", "path":"scene01/clip.mp4", "local_key":"stable-key"}]}, "scenes":[{"number":1}]});
        let mut moved = original.clone();
        moved["scenes"] = json!([]);
        assert!(check_write(&moved, Some(&original)).is_ok());
        moved["media"]["assets"][0]["path"] = json!("scene03/clip.mp4");
        assert!(check_write(&moved, Some(&original)).is_err());
        moved["media"]["assets"] = json!([]);
        assert!(check_write(&moved, Some(&original)).is_err());
    }
}

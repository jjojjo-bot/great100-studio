use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

const IMAGE_MODEL: &str = "gpt-image-2.5-flare";

#[derive(Debug, Deserialize)]
struct ProjectInput {
    folder_name: String,
    source_text: String,
    #[serde(flatten)]
    rest: serde_json::Map<String, Value>,
}

#[derive(Debug, Deserialize)]
struct GenerateRequest {
    project_path: String,
    asset_kind: String,
    scene_number: Option<u32>,
    prompt: String,
    count: usize,
    reference_image: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImportRequest {
    project_path: String,
    asset_kind: String,
    scene_number: Option<u32>,
    data_url: String,
}

#[derive(Debug, Serialize)]
struct ImageCandidate {
    id: String,
    path: String,
    preview_url: String,
    created_at: String,
    mode: String,
}

fn projects_root() -> Result<PathBuf, String> {
    let current = env::current_dir().map_err(|error| error.to_string())?;
    let root = if current.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        current.parent().unwrap_or(&current).to_path_buf()
    } else {
        current
    };
    Ok(root.join("projects"))
}

fn safe_project_path(path: &str) -> Result<PathBuf, String> {
    let root = projects_root()?;
    let candidate = PathBuf::from(path);
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("상위 폴더 경로는 사용할 수 없습니다.".into());
    }
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        root.parent().unwrap_or(&root).join(candidate)
    };
    if !resolved.starts_with(&root) {
        return Err("프로젝트 폴더 밖에는 저장할 수 없습니다.".into());
    }
    Ok(resolved)
}

fn asset_output_dir(project_dir: &Path, kind: &str, scene_number: Option<u32>) -> Result<PathBuf, String> {
    match kind {
        "anchor" => Ok(project_dir.join("02_character")),
        "thumbnail" => Ok(project_dir.join("04_thumbnail")),
        "scene" | "support" => Ok(project_dir.join(format!("03_images/scene{:02}", scene_number.ok_or("장면 번호가 없습니다.")?))),
        _ => Err("알 수 없는 이미지 종류입니다.".into()),
    }
}

#[tauri::command]
fn create_project(project: ProjectInput) -> Result<String, String> {
    if !matches!(
        Path::new(&project.folder_name).components().next(),
        Some(Component::Normal(_))
    ) || Path::new(&project.folder_name).components().count() != 1
    {
        return Err("올바른 프로젝트 폴더명이 아닙니다.".into());
    }
    let root = projects_root()?;
    let project_dir = root.join(&project.folder_name);
    for relative in [
        "01_source",
        "02_character",
        "03_images",
        "04_thumbnail",
        "05_exports",
        "06_logs",
    ] {
        fs::create_dir_all(project_dir.join(relative)).map_err(|error| error.to_string())?;
    }
    fs::write(
        project_dir.join("01_source/work_result.txt"),
        &project.source_text,
    )
    .map_err(|error| error.to_string())?;
    let relative = format!("projects/{}", project.folder_name);
    let mut value = Value::Object(project.rest);
    if let Value::Object(ref mut map) = value {
        map.insert("folder_name".into(), Value::String(project.folder_name));
        map.insert("source_text".into(), Value::String(project.source_text));
        map.insert("project_path".into(), Value::String(relative.clone()));
    }
    write_json(&project_dir.join("project_data.json"), &value)?;
    Ok(relative)
}

#[tauri::command]
fn list_projects() -> Result<Vec<Value>, String> {
    let root = projects_root()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut projects = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path().join("project_data.json");
        if !path.is_file() {
            continue;
        }
        if let Ok(bytes) = fs::read(path) {
            if let Ok(project) = serde_json::from_slice::<Value>(&bytes) {
                projects.push(project);
            }
        }
    }
    projects.sort_by(|a, b| {
        b.get("updated_at")
            .and_then(Value::as_str)
            .cmp(&a.get("updated_at").and_then(Value::as_str))
    });
    Ok(projects)
}

#[tauri::command]
fn save_project(project: Value) -> Result<(), String> {
    let project_path = project
        .get("project_path")
        .and_then(Value::as_str)
        .ok_or("project_path가 없습니다.")?;
    let dir = safe_project_path(project_path)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    write_json(&dir.join("project_data.json"), &project)
}

#[tauri::command]
fn delete_project(project_path: String, project_id: String) -> Result<String, String> {
    let root = projects_root()?.canonicalize().map_err(|error| error.to_string())?;
    let requested = safe_project_path(&project_path)?;
    let metadata = fs::symlink_metadata(&requested).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("프로젝트 폴더만 삭제할 수 있습니다.".into());
    }
    let project_dir = requested.canonicalize().map_err(|error| error.to_string())?;
    if project_dir.parent() != Some(root.as_path()) {
        return Err("프로젝트 루트의 직접 하위 폴더만 삭제할 수 있습니다.".into());
    }
    let data: Value = serde_json::from_slice(&fs::read(project_dir.join("project_data.json")).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let folder = project_dir.file_name().and_then(|name| name.to_str()).ok_or("프로젝트 폴더명이 올바르지 않습니다.")?;
    if data.get("id").and_then(Value::as_str) != Some(project_id.as_str())
        || data.get("folder_name").and_then(Value::as_str) != Some(folder)
        || data.get("project_path").and_then(Value::as_str) != Some(project_path.as_str())
    {
        return Err("삭제할 프로젝트 정보가 저장된 내용과 일치하지 않습니다.".into());
    }
    let trash = root.join(".trash");
    if trash.exists() {
        let trash_metadata = fs::symlink_metadata(&trash).map_err(|error| error.to_string())?;
        if !trash_metadata.is_dir() || trash_metadata.file_type().is_symlink() {
            return Err("프로젝트 휴지통 경로가 올바르지 않습니다.".into());
        }
    } else {
        fs::create_dir(&trash).map_err(|error| error.to_string())?;
    }
    if trash.canonicalize().map_err(|error| error.to_string())?.parent() != Some(root.as_path()) {
        return Err("프로젝트 휴지통은 프로젝트 폴더 안에 있어야 합니다.".into());
    }
    let target = trash.join(format!("{folder}_{}", Uuid::new_v4()));
    fs::rename(&project_dir, &target).map_err(|error| error.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
async fn generate_images(request: GenerateRequest) -> Result<Vec<ImageCandidate>, String> {
    let project_dir = safe_project_path(&request.project_path)?;
    let output_dir = asset_output_dir(&project_dir, &request.asset_kind, request.scene_number)?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    log_prompt(&project_dir, &request)?;

    let count = request.count.clamp(1, 4);
    if let Ok(api_key) = env::var("OPENAI_API_KEY") {
        match generate_openai(&api_key, &request, &output_dir, count).await {
            Ok(images) => return Ok(images),
            Err(error) => log_error(&project_dir, &error),
        }
    }
    generate_mock(&request, &output_dir, count)
}

#[tauri::command]
fn import_image(request: ImportRequest) -> Result<ImageCandidate, String> {
    let project_dir = safe_project_path(&request.project_path)?;
    let output_dir = asset_output_dir(&project_dir, &request.asset_kind, request.scene_number)?;
    let (header, encoded) = request.data_url.split_once(',').ok_or("이미지 데이터 형식이 올바르지 않습니다.")?;
    let extension = match header {
        "data:image/png;base64" => "png",
        "data:image/jpeg;base64" => "jpg",
        "data:image/webp;base64" => "webp",
        _ => return Err("PNG, JPEG, WebP 이미지만 사용할 수 있습니다.".into()),
    };
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > 12_000_000 {
        return Err("12MB 이하 이미지만 업로드할 수 있습니다.".into());
    }
    let valid = match extension {
        "png" => bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
        "jpg" => bytes.starts_with(&[255, 216, 255]),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !valid { return Err("이미지 파일 내용이 올바르지 않습니다.".into()); }
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let id = Uuid::new_v4().to_string();
    let path = output_dir.join(format!("candidate_{id}.{extension}"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(ImageCandidate {
        id,
        path: path.to_string_lossy().into_owned(),
        preview_url: request.data_url,
        created_at: Utc::now().to_rfc3339(),
        mode: "uploaded".into(),
    })
}

#[tauri::command]
fn save_video(project_path: String, data_url: String) -> Result<String, String> {
    let project_dir = safe_project_path(&project_path)?;
    if !project_dir.join("project_data.json").is_file() {
        return Err("프로젝트를 찾지 못했습니다.".into());
    }
    let encoded = data_url.strip_prefix("data:video/mp4;base64,").ok_or("MP4 데이터 형식이 올바르지 않습니다.")?;
    if encoded.len() > 270_000_000 { return Err("MP4 파일은 200MB 이하만 저장할 수 있습니다.".into()); }
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.len() < 12 || bytes.get(4..8) != Some(&b"ftyp"[..]) {
        return Err("올바른 MP4 파일이 아닙니다.".into());
    }
    let folder = project_dir.file_name().and_then(|name| name.to_str()).ok_or("프로젝트 폴더명이 올바르지 않습니다.")?;
    let path = project_dir.join("05_exports").join(format!("{folder}.mp4"));
    fs::create_dir_all(path.parent().ok_or("내보내기 폴더가 없습니다.")?).map_err(|error| error.to_string())?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn music_extension(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "audio/mpeg" => Ok("mp3"),
        "audio/wav" => Ok("wav"),
        "audio/mp4" => Ok("m4a"),
        "video/mp4" => Ok("mp4"),
        _ => Err("MP3, WAV, M4A, MP4 배경음악만 사용할 수 있습니다.".into()),
    }
}

fn music_dir(project_path: &str) -> Result<PathBuf, String> {
    let project_dir = safe_project_path(project_path)?;
    if !project_dir.join("project_data.json").is_file() {
        return Err("프로젝트를 찾지 못했습니다.".into());
    }
    let dir = project_dir.join("01_source");
    let metadata = fs::symlink_metadata(&dir).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("배경음악 폴더가 올바르지 않습니다.".into());
    }
    Ok(dir)
}

fn checked_music_path(dir: &Path, extension: &str) -> Result<PathBuf, String> {
    let path = dir.join(format!("background_music.{extension}"));
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("배경음악 파일 경로가 올바르지 않습니다.".into());
        }
    }
    Ok(path)
}

#[tauri::command]
fn save_background_music(project_path: String, mime_type: String, data_url: String) -> Result<String, String> {
    let extension = music_extension(&mime_type)?;
    let dir = music_dir(&project_path)?;
    let (_, encoded) = data_url.split_once(',').ok_or("음악 데이터 형식이 올바르지 않습니다.")?;
    if !data_url.starts_with(&format!("data:{mime_type};base64,")) || encoded.len() > 134_000_000 {
        return Err("100MB 이하 오디오 파일만 사용할 수 있습니다.".into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > 100_000_000 {
        return Err("100MB 이하 오디오 파일만 사용할 수 있습니다.".into());
    }
    let valid = match extension {
        "mp3" => bytes.starts_with(b"ID3") || (bytes.len() > 1 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0),
        "wav" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WAVE"[..]),
        "m4a" | "mp4" => bytes.get(4..8) == Some(&b"ftyp"[..]),
        _ => false,
    };
    if !valid { return Err("음악 파일 내용이 올바르지 않습니다.".into()); }
    let path = checked_music_path(&dir, extension)?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    for old_extension in ["mp3", "wav", "m4a", "mp4"] {
        if old_extension != extension {
            let old = checked_music_path(&dir, old_extension)?;
            if old.is_file() { fs::remove_file(old).map_err(|error| error.to_string())?; }
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_background_music(project_path: String, mime_type: String) -> Result<String, String> {
    let extension = music_extension(&mime_type)?;
    let path = checked_music_path(&music_dir(&project_path)?, extension)?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() > 100_000_000 { return Err("배경음악 파일이 너무 큽니다.".into()); }
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn remove_background_music(project_path: String) -> Result<(), String> {
    let dir = music_dir(&project_path)?;
    for extension in ["mp3", "wav", "m4a", "mp4"] {
        let path = checked_music_path(&dir, extension)?;
        if path.is_file() { fs::remove_file(path).map_err(|error| error.to_string())?; }
    }
    Ok(())
}

fn narration_extension(mime_type: &str) -> Result<&'static str, String> {
    match mime_type {
        "audio/mpeg" => Ok("mp3"),
        "audio/wav" => Ok("wav"),
        "audio/mp4" => Ok("m4a"),
        "video/mp4" => Ok("mp4"),
        "audio/webm" => Ok("webm"),
        _ => Err("지원하지 않는 녹음 형식입니다.".into()),
    }
}

fn narration_dir(project_path: &str, scene_number: u32) -> Result<PathBuf, String> {
    if !(1..=9999).contains(&scene_number) { return Err("장면 번호가 올바르지 않습니다.".into()); }
    let project = safe_project_path(project_path)?;
    if !project.join("project_data.json").is_file() { return Err("프로젝트를 찾지 못했습니다.".into()); }
    let parent = project.join("03_images");
    let metadata = fs::symlink_metadata(&parent).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() { return Err("장면 폴더가 올바르지 않습니다.".into()); }
    let dir = parent.join(format!("scene{scene_number:02}"));
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let metadata = fs::symlink_metadata(&dir).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() { return Err("장면 폴더가 올바르지 않습니다.".into()); }
    Ok(dir)
}

fn checked_narration_path(dir: &Path, extension: &str) -> Result<PathBuf, String> {
    let path = dir.join(format!("narration.{extension}"));
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("녹음 파일 경로가 올바르지 않습니다.".into()); }
    }
    Ok(path)
}

#[tauri::command]
fn save_scene_narration(project_path: String, scene_number: u32, mime_type: String, data_url: String) -> Result<String, String> {
    let extension = narration_extension(&mime_type)?;
    let dir = narration_dir(&project_path, scene_number)?;
    let prefix = format!("data:{mime_type};base64,");
    let encoded = data_url.strip_prefix(&prefix).ok_or("녹음 데이터 형식이 올바르지 않습니다.")?;
    if encoded.len() > 40_000_004 { return Err("30MB 이하 녹음만 사용할 수 있습니다.".into()); }
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.is_empty() || bytes.len() > 30_000_000 { return Err("30MB 이하 녹음만 사용할 수 있습니다.".into()); }
    let valid = match extension {
        "mp3" => bytes.starts_with(b"ID3") || (bytes.len() > 1 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0),
        "wav" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(&b"WAVE"[..]),
        "m4a" | "mp4" => bytes.get(4..8) == Some(&b"ftyp"[..]),
        "webm" => bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        _ => false,
    };
    if !valid { return Err("녹음 파일 내용이 올바르지 않습니다.".into()); }
    let path = checked_narration_path(&dir, extension)?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    for old_extension in ["mp3", "wav", "m4a", "mp4", "webm"] {
        if old_extension != extension {
            let old = checked_narration_path(&dir, old_extension)?;
            if old.is_file() { fs::remove_file(old).map_err(|error| error.to_string())?; }
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_scene_narration(project_path: String, scene_number: u32, mime_type: String) -> Result<String, String> {
    let extension = narration_extension(&mime_type)?;
    let path = checked_narration_path(&narration_dir(&project_path, scene_number)?, extension)?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() > 30_000_000 { return Err("녹음 파일이 너무 큽니다.".into()); }
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn remove_scene_narration(project_path: String, scene_number: u32) -> Result<(), String> {
    let dir = narration_dir(&project_path, scene_number)?;
    for extension in ["mp3", "wav", "m4a", "mp4", "webm"] {
        let path = checked_narration_path(&dir, extension)?;
        if path.is_file() { fs::remove_file(path).map_err(|error| error.to_string())?; }
    }
    Ok(())
}

#[tauri::command]
fn import_scene_video(project_path: String, scene_number: u32, data_url: String) -> Result<Value, String> {
    let encoded = data_url.strip_prefix("data:video/mp4;base64,").ok_or("MP4 데이터 형식이 올바르지 않습니다.")?;
    if encoded.len() > 67_000_000 { return Err("50MB 이하 동영상만 업로드할 수 있습니다.".into()); }
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.len() < 12 || bytes.len() > 50_000_000 || bytes.get(4..8) != Some(&b"ftyp"[..]) {
        return Err("50MB 이하의 올바른 MP4 파일만 업로드할 수 있습니다.".into());
    }
    let dir = narration_dir(&project_path, scene_number)?;
    let id = Uuid::new_v4();
    let path = dir.join(format!("candidate_{id}.mp4"));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({"id": id.to_string(), "path": path.to_string_lossy()}))
}

#[tauri::command]
fn read_scene_video(project_path: String, scene_number: u32, candidate_id: String) -> Result<String, String> {
    let id = Uuid::parse_str(&candidate_id).map_err(|_| "동영상 ID가 올바르지 않습니다.")?;
    let dir = narration_dir(&project_path, scene_number)?;
    let path = dir.join(format!("candidate_{id}.mp4"));
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 50_000_000 {
        return Err("동영상 파일이 올바르지 않습니다.".into());
    }
    Ok(STANDARD.encode(fs::read(path).map_err(|error| error.to_string())?))
}

#[tauri::command]
fn delete_candidate_file(project_path: String, asset_kind: String, scene_number: Option<u32>, candidate_id: String, candidate_path: String) -> Result<(), String> {
    let project_dir = safe_project_path(&project_path)?;
    let data: Value = serde_json::from_slice(&fs::read(project_dir.join("project_data.json")).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let asset = match asset_kind.as_str() {
        "anchor" => data.get("anchor"),
        "thumbnail" => data.get("thumbnail"),
        "scene" | "support" => {
            let number = scene_number.ok_or("장면 번호가 없습니다.")?;
            if !(1..=9999).contains(&number) { return Err("장면 번호가 올바르지 않습니다.".into()); }
            data.get("scenes").and_then(Value::as_array)
                .and_then(|scenes| scenes.iter().find(|scene| scene.get("number").and_then(Value::as_u64) == Some(number as u64)))
        },
        _ => return Err("후보 종류가 올바르지 않습니다.".into()),
    }.ok_or("후보 목록을 찾지 못했습니다.")?;
    let key = if asset_kind == "support" { "support_candidates" } else { "candidates" };
    let registered = asset.get(key).and_then(Value::as_array)
        .map(|items| items.iter().any(|item| item.get("id").and_then(Value::as_str) == Some(candidate_id.as_str())
            && item.get("path").and_then(Value::as_str) == Some(candidate_path.as_str())))
        .unwrap_or(false);
    if !registered { return Err("삭제할 후보가 프로젝트에 등록되어 있지 않습니다.".into()); }

    let dir = asset_output_dir(&project_dir, &asset_kind, scene_number)?;
    let dir_metadata = fs::symlink_metadata(&dir).map_err(|error| error.to_string())?;
    if !dir_metadata.is_dir() || dir_metadata.file_type().is_symlink() { return Err("후보 폴더가 올바르지 않습니다.".into()); }
    let path = PathBuf::from(&candidate_path);
    if path.parent() != Some(dir.as_path()) { return Err("프로젝트 폴더 밖의 파일은 삭제할 수 없습니다.".into()); }
    let filename = path.file_name().and_then(|value| value.to_str()).ok_or("후보 파일명이 올바르지 않습니다.")?;
    let (stem, extension) = filename.rsplit_once('.').ok_or("후보 파일명이 올바르지 않습니다.")?;
    let uuid = stem.strip_prefix("candidate_").or_else(|| stem.strip_prefix("mock_candidate_"))
        .ok_or("후보 파일명이 올바르지 않습니다.")?;
    Uuid::parse_str(uuid).map_err(|_| "후보 파일명이 올바르지 않습니다.")?;
    if !["png", "jpg", "webp", "svg", "mp4"].contains(&extension) { return Err("후보 파일 형식이 올바르지 않습니다.".into()); }
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("후보 파일이 올바르지 않습니다.".into()); }
    fs::remove_file(path).map_err(|error| error.to_string())
}

async fn generate_openai(
    api_key: &str,
    request: &GenerateRequest,
    output_dir: &Path,
    count: usize,
) -> Result<Vec<ImageCandidate>, String> {
    let client = reqwest::Client::new();
    let reference = request
        .reference_image
        .as_deref()
        .and_then(|image| image.strip_prefix("data:image/"));
    let image_request = if let Some(reference) = reference {
        let (mime_and_encoding, data) = reference
            .split_once(',')
            .ok_or("기준 이미지 형식이 올바르지 않습니다.")?;
        let mime = mime_and_encoding
            .strip_suffix(";base64")
            .ok_or("기준 이미지 형식이 올바르지 않습니다.")?;
        if !matches!(mime, "png" | "jpeg" | "webp") {
            return Err("지원하지 않는 기준 이미지 형식입니다.".into());
        }
        let bytes = STANDARD.decode(data).map_err(|error| error.to_string())?;
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(format!("anchor.{mime}"))
            .mime_str(&format!("image/{mime}"))
            .map_err(|error| error.to_string())?;
        let form = reqwest::multipart::Form::new()
            .text("model", IMAGE_MODEL)
            .text("prompt", request.prompt.clone())
            .text("n", count.to_string())
            .text("size", "1536x864")
            .text("quality", "medium")
            .text("output_format", "jpeg")
            .text("output_compression", "70")
            .part("image", part);
        client
            .post("https://api.openai.com/v1/images/edits")
            .bearer_auth(api_key)
            .multipart(form)
    } else {
        client.post("https://api.openai.com/v1/images/generations").bearer_auth(api_key).json(&serde_json::json!({
            "model": IMAGE_MODEL, "prompt": request.prompt, "n": count, "size": "1536x864", "quality": "medium", "output_format": "jpeg", "output_compression": 70
        }))
    };
    let response = image_request
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body: Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("OpenAI API {}: {}", status, body));
    }
    let items = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("이미지 데이터가 없습니다.")?;
    let mut candidates = Vec::new();
    for item in items {
        let encoded = item
            .get("b64_json")
            .and_then(Value::as_str)
            .ok_or("b64_json이 없습니다.")?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|error| error.to_string())?;
        let path = output_dir.join(format!("candidate_{}.jpg", Uuid::new_v4()));
        fs::write(&path, bytes).map_err(|error| error.to_string())?;
        candidates.push(ImageCandidate {
            id: Uuid::new_v4().to_string(),
            path: path.to_string_lossy().into_owned(),
            preview_url: format!("data:image/jpeg;base64,{encoded}"),
            created_at: Utc::now().to_rfc3339(),
            mode: "openai".into(),
        });
    }
    Ok(candidates)
}

fn generate_mock(
    request: &GenerateRequest,
    output_dir: &Path,
    count: usize,
) -> Result<Vec<ImageCandidate>, String> {
    let palettes = [
        ("173b36", "dc8b50"),
        ("63352d", "e2b66b"),
        ("203d5b", "79a49b"),
        ("514263", "d6a35f"),
    ];
    let label = match request.asset_kind.as_str() {
        "scene" | "support" => format!("{} {:02}", request.asset_kind.to_uppercase(), request.scene_number.unwrap_or(0)),
        other => other.to_uppercase(),
    };
    let mut candidates = Vec::new();
    for index in 0..count {
        let (start, end) = palettes[index % palettes.len()];
        let svg = mock_svg(&label, index + 1, start, end);
        let path = output_dir.join(format!("mock_candidate_{}.svg", Uuid::new_v4()));
        fs::write(&path, svg.as_bytes()).map_err(|error| error.to_string())?;
        candidates.push(ImageCandidate {
            id: Uuid::new_v4().to_string(),
            path: path.to_string_lossy().into_owned(),
            preview_url: format!(
                "data:image/svg+xml;base64,{}",
                STANDARD.encode(svg.as_bytes())
            ),
            created_at: Utc::now().to_rfc3339(),
            mode: "mock".into(),
        });
    }
    Ok(candidates)
}

fn mock_svg(label: &str, number: usize, start: &str, end: &str) -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><defs><linearGradient id="g"><stop stop-color="#{start}"/><stop offset="1" stop-color="#{end}"/></linearGradient></defs><rect width="1536" height="1024" fill="url(#g)"/><circle cx="768" cy="390" r="170" fill="#efd0a8" opacity=".93"/><path d="M430 1024 Q500 570 768 595 Q1036 570 1106 1024" fill="#b94c3c"/><path d="M590 330 Q768 95 946 330 L890 242 L646 242Z" fill="#202e2e"/><text x="72" y="900" font-family="sans-serif" font-size="54" fill="white">{label}</text><text x="72" y="955" font-family="sans-serif" font-size="26" fill="white" opacity=".65">MOCK PREVIEW · {number}</text></svg>"##
    )
}

fn log_prompt(project_dir: &Path, request: &GenerateRequest) -> Result<(), String> {
    let log = serde_json::json!({ "created_at": Utc::now(), "asset_kind": request.asset_kind, "scene_number": request.scene_number, "prompt": request.prompt, "model": IMAGE_MODEL });
    let path = project_dir.join("06_logs/prompt_history.jsonl");
    let mut existing = fs::read_to_string(&path).unwrap_or_default();
    existing.push_str(&serde_json::to_string(&log).map_err(|error| error.to_string())?);
    existing.push('\n');
    fs::write(path, existing).map_err(|error| error.to_string())
}

fn log_error(project_dir: &Path, message: &str) {
    let path = project_dir.join("06_logs/api_errors.log");
    let mut existing = fs::read_to_string(&path).unwrap_or_default();
    existing.push_str(&format!("{} {}\n", Utc::now().to_rfc3339(), message));
    let _ = fs::write(path, existing);
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_project,
            list_projects,
            save_project,
            delete_project,
            generate_images,
            import_image,
            save_video,
            save_background_music,
            read_background_music,
            remove_background_music,
            save_scene_narration,
            read_scene_narration,
            remove_scene_narration,
            import_scene_video,
            read_scene_video,
            delete_candidate_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Great100 Studio");
}

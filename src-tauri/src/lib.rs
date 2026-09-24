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
        "scene" => Ok(project_dir.join(format!("03_images/scene{:02}", scene_number.ok_or("장면 번호가 없습니다.")?))),
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
        "scene" => format!("SCENE {:02}", request.scene_number.unwrap_or(0)),
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
            generate_images,
            import_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Great100 Studio");
}

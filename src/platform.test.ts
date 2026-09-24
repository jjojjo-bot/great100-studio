import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createProjectDraft } from "./parser";
import { buildProjectZip, detectImageFormat, importImageCandidates } from "./platform";
import { SAMPLE_WORK_TEXT } from "./sample";

describe("project export", () => {
  it("includes the source, selected image, project data and prompt history", async () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = `projects/${project.folder_name}`;
    project.anchor.candidates = [{ id: "one", path: `${project.project_path}/02_character/candidate_one.svg`, preview_url: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E", created_at: "2026-09-24T00:00:00Z", mode: "mock" }];
    project.anchor.selected_candidate_id = "one";
    const blob = await buildProjectZip(project);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const folder = `${project.folder_name}/`;
    expect(zip.file(`${folder}01_source/work_result.txt`)).not.toBeNull();
    expect(zip.file(`${folder}02_character/candidate_one.svg`)).not.toBeNull();
    expect(zip.file(`${folder}02_character/selected.svg`)).not.toBeNull();
    expect(zip.file(`${folder}06_logs/prompt_history.jsonl`)).not.toBeNull();
    const metadata = JSON.parse(await zip.file(`${folder}project_data.json`)!.async("string"));
    expect(metadata.anchor.candidates[0].preview_url).toBe("");
  });

  it("includes an uploaded selection in the standard folder", async () => {
    const project = createProjectDraft(2, "이순신", "장군 · 지도자", SAMPLE_WORK_TEXT);
    project.project_path = `projects/${project.folder_name}`;
    project.scenes[0].candidates = [{ id: "uploaded", path: `${project.project_path}/03_images/scene01/candidate_uploaded.png`, preview_url: "data:image/png;base64,iVBORw0KGgo=", created_at: "2026-09-24T00:00:00Z", mode: "uploaded" }];
    project.scenes[0].selected_candidate_id = "uploaded";
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project)).arrayBuffer());
    const folder = `${project.folder_name}/03_images/scene01/`;
    expect(zip.file(`${folder}candidate_uploaded.png`)).not.toBeNull();
    expect(zip.file(`${folder}selected.png`)).not.toBeNull();
  });
});

describe("uploaded image validation", () => {
  it("accepts PNG, JPEG and WebP signatures", () => {
    expect(detectImageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))?.extension).toBe("png");
    expect(detectImageFormat(new Uint8Array([255, 216, 255]))?.extension).toBe("jpg");
    expect(detectImageFormat(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]))?.extension).toBe("webp");
    expect(detectImageFormat(new Uint8Array([60, 115, 118, 103]))).toBeNull();
  });

  it("imports a local image as a selectable candidate", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("FileReader", class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File) {
        file.arrayBuffer().then((buffer) => {
          this.result = `data:${file.type};base64,${Buffer.from(buffer).toString("base64")}`;
          this.onload?.();
        }).catch(() => this.onerror?.());
      }
    });
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "anchor.png", { type: "image/png" });
    const [candidate] = await importImageCandidates([file], { project_path: "projects/002_이순신", asset_kind: "anchor" });
    expect(candidate.mode).toBe("uploaded");
    expect(candidate.path).toMatch(/^projects\/002_이순신\/02_character\/candidate_.+\.png$/);
    expect(candidate.preview_url).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
});

afterEach(() => vi.unstubAllGlobals());

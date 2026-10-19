import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formats: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg",
  "video/mp4": "mp4", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/webm": "webm",
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "POST 요청만 사용할 수 있습니다." });
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response.status(401).json({ error: "로그인이 필요합니다." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response.status(503).json({ error: "계정 저장 연결을 준비하고 있습니다." });
  try {
    const database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user }, error: authError } = await database.auth.getUser(token);
    if (authError || !user) return response.status(401).json({ error: "다시 로그인해 주세요." });
    const { operation, projectId } = request.body || {};
    const configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
    if (operation === "status") {
      const { error } = await database.from("great100_projects").select("id").limit(1);
      let storageReady = false;
      if (configured) {
        try { await storageClient().send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET_NAME })); storageReady = true; }
        catch { /* The client gets a setup state without credential or upstream error details. */ }
      }
      return response.status(200).json({ databaseReady: !error, storageReady });
    }
    if (!configured) return response.status(503).json({ error: "파일 저장소 연결을 준비하고 있습니다." });
    if (typeof projectId !== "string" || !uuid.test(projectId)) return response.status(400).json({ error: "프로젝트를 확인해 주세요." });
    const { data: project, error: projectError } = await database.from("great100_projects").select("id").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    if (projectError) return response.status(503).json({ error: "프로젝트 저장소에 연결하지 못했습니다." });
    if (!project) return response.status(404).json({ error: "접근할 수 없는 프로젝트입니다." });
    const prefix = `${user.id}/${projectId}/`;
    const bucket = process.env.R2_BUCKET_NAME!;
    const storage = storageClient();
    const validKey = (value: unknown): value is string => typeof value === "string" && value.startsWith(prefix) && /^[a-zA-Z0-9/_.-]+$/.test(value) && !value.includes("..");
    if (operation === "upload") {
      const { contentType, size } = request.body;
      const extension = typeof contentType === "string" && Object.hasOwn(formats, contentType) ? formats[contentType] : undefined;
      const maxBytes = typeof contentType === "string" && contentType.startsWith("image/") ? 12_000_000 : 200_000_000;
      if (!extension || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) return response.status(400).json({ error: "파일 형식이나 크기를 확인해 주세요." });
      const objectKey = `${prefix}${randomUUID()}.${extension}`;
      const uploadUrl = await getSignedUrl(storage, new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: contentType, ContentLength: size }), { expiresIn: 900 });
      return response.status(200).json({ key: objectKey, url: uploadUrl });
    }
    if (operation === "read") {
      const keys = request.body.keys;
      if (!Array.isArray(keys) || !keys.length || keys.length > 100 || !keys.every(validKey)) return response.status(400).json({ error: "파일 경로를 확인해 주세요." });
      const entries = await Promise.all([...new Set<string>(keys)].map(async objectKey => [objectKey, await getSignedUrl(storage, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: 86400 })]));
      return response.status(200).json({ urls: Object.fromEntries(entries) });
    }
    if (operation === "delete") {
      if (!validKey(request.body.key)) return response.status(400).json({ error: "파일 경로를 확인해 주세요." });
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: request.body.key }));
      return response.status(200).json({ deleted: true });
    }
    if (operation === "delete-project") {
      // Always list from the start as the preceding page is removed before the next request.
      while (true) {
        const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
        const objects = page.Contents?.filter(object => object.Key?.startsWith(prefix)).map(object => ({ Key: object.Key! })) || [];
        if (!objects.length) break;
        const result = await storage.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
        if (result.Errors?.length) throw new Error("Storage deletion failed");
      }
      return response.status(200).json({ deleted: true });
    }
    return response.status(400).json({ error: "지원하지 않는 파일 요청입니다." });
  } catch {
    return response.status(502).json({ error: "파일 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  }
}

function storageClient() {
  return new S3Client({
    region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
}

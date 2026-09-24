import { timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 120 };

const MODEL = "gpt-image-2.5-flare";

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "POST 요청만 사용할 수 있습니다." });
  const apiKey = process.env.OPENAI_API_KEY;
  const accessCode = process.env.GREAT100_ACCESS_KEY;
  if (!apiKey || !accessCode) return response.status(503).json({ error: "실제 이미지 생성이 설정되지 않았습니다. 관리자에게 문의하세요." });
  const supplied = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!equalSecret(supplied, accessCode)) return response.status(401).json({ error: "접근 코드가 올바르지 않습니다." });

  const prompt = typeof request.body?.prompt === "string" ? request.body.prompt.trim() : "";
  if (!prompt || prompt.length > 15_000) return response.status(400).json({ error: "이미지 프롬프트를 확인해 주세요." });
  const reference = typeof request.body?.reference_image === "string" ? request.body.reference_image : "";
  const referenceMatch = reference.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (reference && !referenceMatch) return response.status(400).json({ error: "기준 이미지 형식이 올바르지 않습니다." });
  if (referenceMatch && Buffer.byteLength(referenceMatch[2], "base64") > 3_000_000) return response.status(413).json({ error: "기준 이미지가 너무 큽니다." });

  try {
    const fields = { model: MODEL, prompt, n: 1, size: "1536x864", quality: "medium", output_format: "jpeg", output_compression: 70 };
    let body: string | FormData;
    let endpoint: string;
    let contentType: Record<string, string> = {};
    if (referenceMatch) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      const mime = `image/${referenceMatch[1]}`;
      const bytes = new Uint8Array(Buffer.from(referenceMatch[2], "base64"));
      form.append("image", new Blob([bytes], { type: mime }), `anchor.${referenceMatch[1] === "jpeg" ? "jpg" : referenceMatch[1]}`);
      body = form;
      endpoint = "https://api.openai.com/v1/images/edits";
    } else {
      body = JSON.stringify(fields);
      endpoint = "https://api.openai.com/v1/images/generations";
      contentType = { "Content-Type": "application/json" };
    }
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...contentType },
      body,
      signal: AbortSignal.timeout(110_000),
    });
    const result = await upstream.json() as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!upstream.ok) return response.status(502).json({ error: result.error?.message || "OpenAI 이미지 생성 요청이 실패했습니다." });
    const image = result.data?.[0]?.b64_json;
    if (!image) return response.status(502).json({ error: "OpenAI가 이미지 데이터를 반환하지 않았습니다." });
    if (Buffer.byteLength(image, "utf8") > 4_000_000) return response.status(502).json({ error: "이미지 크기가 웹 응답 한도를 넘었습니다. 프롬프트를 조정해 다시 시도해 주세요." });
    return response.status(200).json({ image_base64: image, mime_type: "image/jpeg", model: MODEL });
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : "이미지 생성 중 문제가 발생했습니다." });
  }
}

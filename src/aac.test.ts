import { expect, it, vi } from "vitest";
import { createAacSupport } from "./aac";
it("keeps native AAC, retries a failed load, and shares one fallback registration between concurrent exports", async () => {
  let supported = true;
  const register = vi.fn(async () => { supported = true; });
  const ensureAacSupport = createAacSupport(async () => supported, register);
  expect(await ensureAacSupport(1, 48000)).toBe(true); expect(register).not.toHaveBeenCalled();
  supported = false;
  register.mockRejectedValueOnce(new Error("load failed"));
  await expect(ensureAacSupport(1, 48000)).rejects.toThrow("load failed");
  expect(await Promise.all([ensureAacSupport(1, 48000), ensureAacSupport(2, 48000)])).toEqual([true, true]);
  expect(register).toHaveBeenCalledTimes(2);
});

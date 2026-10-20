type AudioOptions = { numberOfChannels: number; sampleRate: number };

export function createAacSupport(check: (options: AudioOptions) => Promise<boolean>, load: () => Promise<void>) {
  let registration: Promise<void> | undefined;
  return async (numberOfChannels: number, sampleRate: number): Promise<boolean> => {
    const options = { numberOfChannels, sampleRate };
    if (await check(options)) return true;
    registration ??= load().catch(error => { registration = undefined; throw error; });
    await registration;
    return check(options);
  };
}

export const ensureAacSupport = createAacSupport(
  async options => (await import("mediabunny")).canEncodeAudio("aac", options),
  async () => { const { registerAacEncoder } = await import("@mediabunny/aac-encoder"); registerAacEncoder(); },
);

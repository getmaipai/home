import { requestJson } from "@/lib/api";

let available: Promise<boolean> | undefined;
const decode = (value: string): ArrayBuffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
};
const encode = (value: ArrayBuffer | null): string | null => value === null ? null : btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export function passkeysAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return Promise.resolve(false);
  available ??= requestJson<unknown>("/api/auth/passkeys").then((rows) => Array.isArray(rows) && rows.length > 0).catch(() => false);
  return available;
}

export async function getPasskeyAssertion(): Promise<Record<string, unknown>> {
  const options = await requestJson<Record<string, unknown>>("/api/adult-lock/unlock/options", { method: "POST" });
  const publicKey = { ...options, challenge: decode(String(options.challenge)), allowCredentials: Array.isArray(options.allowCredentials) ? options.allowCredentials.map((credential) => ({ ...(credential as Record<string, unknown>), id: decode(String((credential as Record<string, unknown>).id)) })) : [] } as PublicKeyCredentialRequestOptions;
  const credential = await navigator.credentials.get({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Passkey assertion cancelled");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature), userHandle: encode(response.userHandle) },
    clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment,
  };
}

import { afterEach, describe, expect, mock, test } from "bun:test";
import { getPasskeyAssertion, passkeysAvailable } from "@/lib/passkeyAssertion";

const originalCredentials = navigator.credentials;
const originalPublicKeyCredential = window.PublicKeyCredential;
const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.defineProperty(navigator, "credentials", { configurable: true, value: originalCredentials });
  Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: originalPublicKeyCredential });
  globalThis.fetch = originalFetch;
});

describe("passkey assertion", () => {
  test("converts server options and returns the browser assertion JSON", async () => {
    const raw = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0)).buffer;
    const b64 = (value: string) => btoa(value).replace(/=/g, "");
    class FakePublicKeyCredential {}
    const credential = Object.assign(new FakePublicKeyCredential(), {
      id: "credential-id", rawId: raw("raw"), type: "public-key", authenticatorAttachment: "platform",
      response: { clientDataJSON: raw("client"), authenticatorData: raw("auth"), signature: raw("sig"), userHandle: null },
      getClientExtensionResults: () => ({}),
    }) as unknown as PublicKeyCredential;
    const get = mock(async (options: CredentialRequestOptions) => {
      expect((options.publicKey as PublicKeyCredentialRequestOptions).challenge).toBeInstanceOf(ArrayBuffer);
      expect(((options.publicKey as PublicKeyCredentialRequestOptions).allowCredentials?.[0]?.id)).toBeInstanceOf(ArrayBuffer);
      return credential;
    });
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { get } });
    globalThis.fetch = mock(async () => Response.json({ challenge: b64("challenge"), allowCredentials: [{ id: b64("id"), type: "public-key" }] })) as unknown as typeof fetch;
    const result = await getPasskeyAssertion();
    expect(result).toMatchObject({ id: "credential-id", type: "public-key", response: { clientDataJSON: b64("client"), authenticatorData: b64("auth"), signature: b64("sig"), userHandle: null }, authenticatorAttachment: "platform" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("hides passkey availability without WebAuthn", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
    expect(await passkeysAvailable()).toBe(false);
  });
});

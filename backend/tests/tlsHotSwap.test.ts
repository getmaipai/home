import { describe, expect, test } from "bun:test";
import { connect } from "node:tls";
import forge from "node-forge";

// index.ts's onLeafRenewed() handler rebinds the live server when a leaf
// is renewed - but index.ts itself is never imported by the test suite
// (app.ts/routes stay import-only precisely so booting the app under
// test never starts a real HTTP listener, scheduler intervals, or
// sidecars). That left the actual TLS-rotation mechanism completely
// unverified: a code review (2026-09-06) first "fixed" this with
// `server.reload({ tls })`, and a SECOND review pass caught - empirically,
// not just from reading Bun's docs - that reload() is a no-op for tls:
// the server kept presenting the original certificate. This file proves
// the REAL mechanism index.ts now uses (a graceful server.stop(true)
// followed by a fresh Bun.serve() on the same port) actually swaps the
// served certificate, without needing to import index.ts itself.

function makeSelfSignedCert(cn: string): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024); // small/fast - thrown away immediately
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  cert.setSubject([{ name: "commonName", value: cn }]);
  cert.setIssuer([{ name: "commonName", value: cn }]);
  cert.sign(forge.pki.privateKeyFromPem(forge.pki.privateKeyToPem(keys.privateKey)), forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

function getServedCommonName(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
      const peerCert = socket.getPeerCertificate();
      socket.end();
      resolve((peerCert.subject?.CN as string | undefined) ?? "NONE");
    });
    socket.on("error", reject);
  });
}

describe("TLS rotation mechanism (the one index.ts's onLeafRenewed() uses)", () => {
  test("server.reload({ tls }) does NOT swap the served certificate - documenting why index.ts doesn't use it", async () => {
    const certA = makeSelfSignedCert("cert-A");
    const certB = makeSelfSignedCert("cert-B");
    const server = Bun.serve({ port: 0, fetch: () => new Response("hi"), tls: { cert: certA.certPem, key: certA.keyPem } });
    try {
      expect(await getServedCommonName(server.port!)).toBe("cert-A");
      server.reload({ fetch: () => new Response("hi"), tls: { cert: certB.certPem, key: certB.keyPem } });
      // Bun's own bundled types: reload() only swaps fetch/error handlers.
      expect(await getServedCommonName(server.port!)).toBe("cert-A");
    } finally {
      server.stop(true);
    }
  });

  test("a graceful stop(true) followed by a fresh Bun.serve() on the same port DOES serve the new certificate", async () => {
    const certA = makeSelfSignedCert("cert-A");
    const certB = makeSelfSignedCert("cert-B");
    let server = Bun.serve({ port: 0, fetch: () => new Response("hi"), tls: { cert: certA.certPem, key: certA.keyPem } });
    const port = server.port!;
    try {
      expect(await getServedCommonName(port)).toBe("cert-A");
      server.stop(true);
      server = Bun.serve({ port, fetch: () => new Response("hi"), tls: { cert: certB.certPem, key: certB.keyPem } });
      expect(await getServedCommonName(port)).toBe("cert-B");
    } finally {
      server.stop(true);
    }
  });
});

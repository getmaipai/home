// CHAT-03 (docs/dev/session-a.md): the one memory content policy. Pure,
// offline, synthetic values built here (never a real-looking secret in
// the repo): the pattern of a value, not a value.
import { describe, expect, test } from "bun:test";
import { detectCredential, hasDeclaredCredentialField, redactCredentials, CREDENTIAL_REDACTION } from "@/lib/memoryContentPolicy";

const synthetic = {
  password: `Jun${"i".repeat(2)}per${20}26`, // Juniiper2026: mixed case plus digits
  awsKeyId: `AKIA${"Q".repeat(16)}`,
  githubToken: `ghp_${"a1".repeat(18)}`,
  skKey: `sk-${"x9".repeat(12)}`,
  jwt: `eyJ${"a".repeat(10)}.eyJ${"b".repeat(10)}.${"c".repeat(10)}`,
  hex: "f".repeat(32),
};

describe("detectCredential(): explicit assignments to a credential label", () => {
  test("a password, a token, an API key, a PIN and a cookie given as a value are detected", () => {
    expect(detectCredential(`the wifi password is ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`remember that my password is ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`token = ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`api key: ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`the garage pin was set to 4412a!`).detected).toBe(true);
    expect(detectCredential(`session cookie is "abc123XYZ"`).detected).toBe(true);
    expect(detectCredential(`the router password is '${synthetic.password}'`).detected).toBe(true);
  });

  test("a statement that a credential is managed elsewhere passes", () => {
    for (const benign of [
      "the wifi password is on the fridge",
      "our wifi password is on the fridge, please remember this",
      "my password is managed in Credentials",
      "the api key is the same as last time",
      "the password is written in the notebook",
      "what's a good password",
      "I changed the password yesterday",
      "the token is still valid",
      "please remember our wifi password is on the fridge",
    ]) {
      expect(detectCredential(benign).detected).toBe(false);
    }
  });

  test("a short or plain word after the label is not a value", () => {
    expect(detectCredential("the password is short").detected).toBe(false);
    expect(detectCredential("the password is strong").detected).toBe(false);
    expect(detectCredential("the password is abc").detected).toBe(false);
  });
});

describe("detectCredential(): the known secret formats", () => {
  test("an AWS access key id, a GitHub token, an sk- key, a JWT and a PEM header are detected with no label at all", () => {
    expect(detectCredential(`here you go ${synthetic.awsKeyId}`).kinds).toContain("aws_access_key");
    expect(detectCredential(`use ${synthetic.githubToken} for the repo`).kinds).toContain("github_token");
    expect(detectCredential(`the key is ${synthetic.skKey}`).kinds).toContain("sk_api_key");
    expect(detectCredential(`bearer ${synthetic.jwt}`).kinds).toContain("jwt");
    expect(detectCredential("-----BEGIN RSA PRIVATE KEY-----").kinds).toContain("pem_private_key");
  });

  test("a long hex run counts only next to a credential label: an unlabeled arbitrary string cannot be proven a secret", () => {
    expect(detectCredential(`the secret is ${synthetic.hex}`).detected).toBe(true);
    expect(detectCredential(`the checksum was ${synthetic.hex}`).detected).toBe(false); // the stated limit
    expect(detectCredential("xK9!pLm2qRt7vWz4").detected).toBe(false); // a bare token, no label, no shape
  });
});

describe("detectCredential(): the review's cases", () => {
  test("the word operators are anchored: 'is now', 'for disney plus is', 'for this account is' all detect", () => {
    expect(detectCredential(`my password is now ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`the password for disney plus is ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`the password for this account is ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`my password on this site is ${synthetic.password}`).detected).toBe(true);
  });

  test("a PIN of four or more digits is a value whatever its length", () => {
    expect(detectCredential("the garage pin is 1234").detected).toBe(true);
    expect(detectCredential("the pin code is 4412").detected).toBe(true);
    expect(detectCredential("pin: 0000").detected).toBe(true);
    expect(detectCredential("the passcode is 123456").detected).toBe(true);
  });

  test("a dot inside a password is part of it, and the sentence's own full stop is not", () => {
    expect(detectCredential("the wifi password is Jun.iper2026").detected).toBe(true);
    expect(detectCredential("my password is P@ss.word1").detected).toBe(true);
    expect(redactCredentials("the password is Juniper.2026.")).toBe(`the password is ${CREDENTIAL_REDACTION}.`);
  });

  test("a plain capitalized word is a name, not a value: cookies, secrets and names pass", () => {
    expect(detectCredential("my favorite cookie is Snickerdoodle").detected).toBe(false);
    expect(detectCredential("the secret is Patience").detected).toBe(false);
    expect(detectCredential("remember the secret is Grandma's chocolate cake").detected).toBe(false);
    expect(detectCredential("my password is Bramble").detected).toBe(false);
    expect(detectCredential("the token is MySecretPass").detected).toBe(true); // a capital past the first letter is a value
  });
});

describe("detectCredential(): the delta review's cases", () => {
  test("a rejected token never consumes the label: 'the password to the wifi is X' and 'the password is: X' detect", () => {
    expect(detectCredential(`the password to the wifi is ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential("the pin to the garage is 4412").detected).toBe(true);
    expect(detectCredential(`my password to netflix is ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`the wifi password is: ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential(`the password is: "${synthetic.password}"`).detected).toBe(true);
    expect(detectCredential(`the password is the ${synthetic.password}`).detected).toBe(true);
  });

  test("'to' counts only after a set or change verb: recipients are not values", () => {
    expect(detectCredential(`set the wifi password to ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential("I changed my pin to 4412").detected).toBe(true);
    for (const benign of [
      "I gave my password to my mom",
      "send the token to the printer",
      "I gave my password to Bramble",
      "text the wifi password to 555-0100",
      "send the wifi password to grandma@example.com",
      "send the token to https://example.com/hook",
      "I forwarded the api key to DevOps",
      "give the pin to 4412 main street",
    ]) {
      expect(detectCredential(benign).detected).toBe(false);
    }
  });

  test("past tense and plural copulas are operators", () => {
    expect(detectCredential(`the password was ${synthetic.password}`).detected).toBe(true);
    expect(detectCredential("the pin was 4412").detected).toBe(true);
    expect(detectCredential(`our credentials are admin/${synthetic.password}`).detected).toBe(true);
  });

  test("names with one interior capital are names; a token with two case changes is a value", () => {
    expect(detectCredential("my favorite cookie is McDonald's").detected).toBe(false);
    expect(detectCredential("the secret is iPhone").detected).toBe(false);
    expect(detectCredential("the password is LeBron").detected).toBe(false);
    expect(detectCredential("the token is MySecretPass").detected).toBe(true);
  });

  test("an apostrophe or comma inside a value is part of it", () => {
    expect(detectCredential("the password is Don'tPanic42").detected).toBe(true);
    expect(detectCredential("my password is Hello,World1").detected).toBe(true);
    expect(redactCredentials("the password is Don'tPanic42.")).toBe(`the password is ${CREDENTIAL_REDACTION}.`);
  });
});

describe("hasDeclaredCredentialField()", () => {
  test("a body carrying a credential-named key with a value is rejected by name", () => {
    expect(hasDeclaredCredentialField({ text: "hello", password: "x" })).toBe("password");
    expect(hasDeclaredCredentialField({ text: "hello", api_key: "x" })).toBe("api_key");
    expect(hasDeclaredCredentialField({ text: "hello", apiKey: "x" })).toBe("apiKey");
    expect(hasDeclaredCredentialField({ text: "hello" })).toBeNull();
    expect(hasDeclaredCredentialField({ text: "hello", password: "" })).toBeNull();
    expect(hasDeclaredCredentialField("not an object")).toBeNull();
  });
});

describe("redactCredentials()", () => {
  test("replaces each detected value with the marker and leaves the rest", () => {
    expect(redactCredentials(`remember that the wifi password is ${synthetic.password} for the guests`)).toBe(`remember that the wifi password is ${CREDENTIAL_REDACTION} for the guests`);
    expect(redactCredentials(`here is ${synthetic.awsKeyId} and my token is ${synthetic.password}`)).toBe(`here is ${CREDENTIAL_REDACTION} and my token is ${CREDENTIAL_REDACTION}`);
  });

  test("returns a text with nothing detected unchanged", () => {
    expect(redactCredentials("the wifi password is on the fridge")).toBe("the wifi password is on the fridge");
  });

  test("overlapping hits merge to the widest span: a labeled JWT leaves no payload or signature behind", () => {
    const text = `my token is ${synthetic.jwt}`;
    expect(redactCredentials(text)).toBe(`my token is ${CREDENTIAL_REDACTION}`);
  });

  test("a PEM block is redacted whole, header through footer, so no key body survives (#89)", () => {
    const block = `-----BEGIN RSA PRIVATE KEY-----\n${"MIIE".repeat(8)}\n${"abcd".repeat(8)}\n-----END RSA PRIVATE KEY-----`;
    expect(redactCredentials(`here is the key\n${block}\nthanks`)).toBe(`here is the key\n${CREDENTIAL_REDACTION}\nthanks`);
    expect(redactCredentials("-----BEGIN PRIVATE KEY-----\nMIIEabcd")).toBe(`${CREDENTIAL_REDACTION}\nMIIEabcd`); // a cut paste still marks the header
  });

  test("one value hit by two rules is redacted once", () => {
    const text = `the secret is ${synthetic.hex}`;
    expect(redactCredentials(text)).toBe(`the secret is ${CREDENTIAL_REDACTION}`);
  });
});

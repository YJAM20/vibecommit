import { describe, expect, test } from "vitest";
import { redactSecrets } from "../../src/security/redactor.js";

describe("Secret Redactor Unit Tests", () => {
  // Use strictly fake fixture values
  const FAKE_OPENAI_KEY = "sk-fakeTestKey1234567890abcdef123456";
  const FAKE_GHP_PAT = "ghp_fakeTokenValueForTestingOnly123456";
  const FAKE_GITHUB_FINE_GRAINED = "github_pat_fakeTokenValueForTestingOnly1234567890abcdef123456";
  const FAKE_AWS_ACCESS_KEY = "AKIA1234567890ABCDEF";
  const FAKE_BEARER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakePayloadForTesting.fakeSig";
  const FAKE_DB_URL = "postgres://testuser:fakepassword123@localhost:5432/testdb";
  const FAKE_PEM_KEY = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEA0fakePayloadLine1ForTestingOnly==",
    "fakePayloadLine2ForTestingOnly==",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");

  test("redacts fake OpenAI-style API keys", () => {
    const input = `const client = new OpenAI({ apiKey: "${FAKE_OPENAI_KEY}" });`;
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain(FAKE_OPENAI_KEY);
    expect(sanitizedText).toContain("[REDACTED:openai_api_key]");
    expect(report.totalRedactions).toBe(1);
    expect(report.redactionsByCategory["openai_api_key"]).toBe(1);
  });

  test("redacts fake GitHub personal access tokens", () => {
    const input = `const token = "${FAKE_GHP_PAT}";\nconst pat = "${FAKE_GITHUB_FINE_GRAINED}";`;
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain(FAKE_GHP_PAT);
    expect(sanitizedText).not.toContain(FAKE_GITHUB_FINE_GRAINED);
    expect(sanitizedText).toContain("[REDACTED:github_token]");
    expect(report.totalRedactions).toBe(2);
    expect(report.redactionsByCategory["github_token"]).toBe(2);
  });

  test("redacts fake AWS access key IDs", () => {
    const input = `export AWS_ACCESS_KEY_ID=${FAKE_AWS_ACCESS_KEY}`;
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain(FAKE_AWS_ACCESS_KEY);
    expect(sanitizedText).toContain("[REDACTED:aws_access_key_id]");
    expect(report.totalRedactions).toBe(1);
    expect(report.redactionsByCategory["aws_access_key_id"]).toBe(1);
  });

  test("redacts fake Bearer tokens and preserves Bearer keyword", () => {
    const input = `headers.set("Authorization", "Bearer ${FAKE_BEARER_TOKEN}");`;
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain(FAKE_BEARER_TOKEN);
    expect(sanitizedText).toContain("Bearer [REDACTED:bearer_token]");
    expect(report.totalRedactions).toBe(1);
    expect(report.redactionsByCategory["bearer_token"]).toBe(1);
  });

  test("redacts fake credentialed database URLs", () => {
    const input = `const dbUri = "${FAKE_DB_URL}";`;
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain("fakepassword123");
    expect(sanitizedText).toContain("[REDACTED:database_connection_string]");
    expect(report.totalRedactions).toBe(1);
  });

  test("does not redact uncredentialed database URLs", () => {
    const input = "const dbUri = 'postgres://localhost:5432/mydb';";
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).toBe(input);
    expect(report.totalRedactions).toBe(0);
  });

  test("redacts multiline PEM private key blocks entirely as one redaction", () => {
    const input = `Code before\n${FAKE_PEM_KEY}\nCode after`;
    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain("MIIEowIBAAKCAQEA0fakePayloadLine1ForTestingOnly==");
    expect(sanitizedText).toContain("Code before\n[REDACTED:private_key]\nCode after");
    expect(report.totalRedactions).toBe(1);
    expect(report.redactionsByCategory["private_key"]).toBe(1);
  });

  describe("Sensitive assignment patterns", () => {
    test("redacts shell/env-style unquoted assignment", () => {
      const input = "API_KEY=fakeCustomSecretValueXYZ123";
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).not.toContain("fakeCustomSecretValueXYZ123");
      expect(sanitizedText).toBe("API_KEY=[REDACTED:sensitive_assignment]");
      expect(report.totalRedactions).toBe(1);
    });

    test("redacts quoted variable assignment", () => {
      const input = 'const PASSWORD = "fakeSecretPassword987";';
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).not.toContain("fakeSecretPassword987");
      expect(sanitizedText).toBe('const PASSWORD = "[REDACTED:sensitive_assignment]";');
      expect(report.totalRedactions).toBe(1);
    });

    test("redacts JSON-like key-value assignment", () => {
      const input = '{\n  "apiKey": "fakeSecretTokenInJson456"\n}';
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).not.toContain("fakeSecretTokenInJson456");
      expect(sanitizedText).toContain('"apiKey": "[REDACTED:sensitive_assignment]"');
      expect(report.totalRedactions).toBe(1);
    });
  });

  describe("Near-misses and false-positive resistance", () => {
    test("does not redact unrelated constants like KEY_ENTER", () => {
      const input = "export const KEY_ENTER = 13;";
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).toBe(input);
      expect(report.totalRedactions).toBe(0);
    });

    test("does not redact token type identifiers like TOKEN_TYPE", () => {
      const input = 'const TOKEN_TYPE = "Bearer";';
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).toBe(input);
      expect(report.totalRedactions).toBe(0);
    });

    test("does not redact boolean, null, or undefined assignments", () => {
      const input = "const SECRET = true;\nconst TOKEN = false;\nconst PASSWORD = null;";
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).toBe(input);
      expect(report.totalRedactions).toBe(0);
    });

    test("does not redact process.env references", () => {
      const input = "const API_KEY = process.env.API_KEY;";
      const { sanitizedText, report } = redactSecrets(input);

      expect(sanitizedText).toBe(input);
      expect(report.totalRedactions).toBe(0);
    });
  });

  test("redacts multiple diverse secrets in one input with correct count breakdown", () => {
    const input = [
      `const key = "${FAKE_OPENAI_KEY}";`,
      `const pat = "${FAKE_GHP_PAT}";`,
      `const aws = "${FAKE_AWS_ACCESS_KEY}";`,
      `const auth = "Bearer ${FAKE_BEARER_TOKEN}";`,
    ].join("\n");

    const { sanitizedText, report } = redactSecrets(input);

    expect(sanitizedText).not.toContain(FAKE_OPENAI_KEY);
    expect(sanitizedText).not.toContain(FAKE_GHP_PAT);
    expect(sanitizedText).not.toContain(FAKE_AWS_ACCESS_KEY);
    expect(sanitizedText).not.toContain(FAKE_BEARER_TOKEN);

    expect(report.totalRedactions).toBe(4);
    expect(report.redactionsByCategory["openai_api_key"]).toBe(1);
    expect(report.redactionsByCategory["github_token"]).toBe(1);
    expect(report.redactionsByCategory["aws_access_key_id"]).toBe(1);
    expect(report.redactionsByCategory["bearer_token"]).toBe(1);
  });

  test("zero-leak invariant: report structure contains no secret text", () => {
    const input = `API_KEY="verySensitiveSecretStringThatMustNeverLeak"`;
    const { report } = redactSecrets(input);

    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain("verySensitiveSecretStringThatMustNeverLeak");
    expect(report.totalRedactions).toBe(1);
  });
});

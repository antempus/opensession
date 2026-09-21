import { describe, test, expect, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { discoverProviderModels } from "./model-discovery";
import { configuredPickerModels } from "./model-providers";

const KEY = "OPENSESSION_MODEL_PROVIDERS_CONFIG";
const saved = process.env[KEY];
const dirs: string[] = [];

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function withProvider(): void {
  const dir = mkdtempSync(join(tmpdir(), "os-mp-"));
  dirs.push(dir);
  const file = join(dir, "model-providers.json");
  writeFileSync(
    file,
    JSON.stringify({
      providers: {
        openrouter: {
          apiKey: "k",
          baseURL: "https://example.test/v1",
          api: "openai-completions",
        },
      },
      pickerModels: [],
    }),
  );
  process.env[KEY] = file;
}

const fakeFetch = (async () =>
  new Response(
    JSON.stringify({ data: [{ id: "vendor/alpha" }, { id: "vendor/beta" }] }),
    { headers: { "content-type": "application/json" } },
  )) as unknown as typeof fetch;

describe("discoverProviderModels", () => {
  test("records the catalog but leaves the picker allowlist untouched", async () => {
    withProvider();
    const before = configuredPickerModels();

    const result = await discoverProviderModels("openrouter", fakeFetch);

    // The catalog is recorded (the returned list is what got stored)…
    expect(result.models).toEqual(["vendor/alpha", "vendor/beta"]);

    // …but discovery no longer floods the picker: operators curate up.
    expect(configuredPickerModels()).toEqual(before);
  });
});

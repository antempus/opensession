import { useEffect, useState } from "react";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import { errorMessage } from "../../lib/error-message";
import { BASE_PATH } from "../../lib/base";
import {
  SettingCard,
  SettingsGroupLabel,
  SettingsHeader,
  SettingsHint,
  SettingsPanel,
} from "../../ui/settings";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { OptionSelect } from "../../ui/select";
import { Badge } from "../../ui/badge";
import { InlineAlert } from "../../ui/state";
import { toast } from "../../ui/toast";
import { IconPlus, IconTrash } from "../icons";
import { setupRequest } from "../setup-shared";

type ModelOption = { value: string; label: string };
type Rule = { label: string; model: string };
type AppRepo = { fullName: string };

// Settings → Integrations → Linear. Two concerns: which MODEL a Linear issue
// runs on (by label, with a fallback), and which repos the GitHub App can reach
// (discovery — routing targets stay the registered repos, edited per-repo in
// Setup → Repositories).
export function LinearPanel() {
  const { status, refetch } = useSetupStatus();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [fallback, setFallback] = useState("");
  const [pickup, setPickup] = useState<"implement" | "plan" | "ask">(
    "implement",
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [appRepos, setAppRepos] = useState<AppRepo[] | null>(null);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/models`)
      .then((r) => r.json())
      .then((d: { models?: { id: string; label?: string }[] }) =>
        setModels(
          (d.models ?? []).map((m) => ({
            value: m.id,
            label: m.label || m.id,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/setup/github/repos`)
      .then((r) => r.json())
      .then((d: { repos?: { fullName: string }[] }) =>
        setAppRepos((d.repos ?? []).map((r) => ({ fullName: r.fullName }))),
      )
      .catch((e) =>
        setAppError(errorMessage(e, "Couldn't load GitHub App repos")),
      );
  }, []);

  // Prefill once the status arrives.
  useEffect(() => {
    if (status?.linearRouting && !loaded) {
      setRules(status.linearRouting.modelLabels.map((r) => ({ ...r })));
      setFallback(status.linearRouting.fallbackModel || "");
      setPickup(status.linearRouting.pickupAction ?? "implement");
      setLoaded(true);
    }
  }, [status, loaded]);

  const modelChoices: ModelOption[] = [
    { value: "", label: "Select a model…" },
    ...models,
  ];
  const fallbackChoices: ModelOption[] = [
    { value: "", label: "Global default" },
    ...models,
  ];
  const pickupChoices = [
    { value: "implement", label: "Start implementing (opens a PR)" },
    { value: "plan", label: "Plan first, then wait" },
    { value: "ask", label: "Ask what to do" },
  ];

  function setRule(i: number, patch: Partial<Rule>) {
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const clean = rules
        .map((r) => ({ label: r.label.trim(), model: r.model.trim() }))
        .filter((r) => r.label && r.model);
      await setupRequest("/api/setup/linear/routing", {
        method: "PUT",
        json: {
          modelLabels: clean,
          fallbackModel: fallback,
          pickupAction: pickup,
        },
      });
      toast("Linear settings saved");
      await refetch();
    } catch (e) {
      setError(errorMessage(e, "Failed to save model routing"));
    }
    setSaving(false);
  }

  const registered = new Set(
    (status?.repos ?? [])
      .map((r) => r.ghRepo?.toLowerCase())
      .filter((v): v is string => !!v),
  );

  return (
    <SettingsPanel>
      <SettingsHeader
        title="Linear"
        description="Route Linear-triggered work to a model by label, and see which repositories the GitHub App can reach."
      />

      <SettingsGroupLabel>Ticket pickup</SettingsGroupLabel>
      <SettingCard>
        <div className="flex flex-col gap-2 p-3 desktop:flex-row desktop:items-center desktop:justify-between">
          <span className="text-dim text-body">
            When the agent picks up a ticket
          </span>
          <OptionSelect
            label="On ticket pickup"
            className="w-full desktop:w-72"
            value={pickup}
            options={pickupChoices}
            onChange={(v) => {
              // SAFETY: v is always one of pickupChoices' values, which are
              // exactly the three valid pickup actions.
              setPickup(v as "implement" | "plan" | "ask");
            }}
          />
        </div>
      </SettingCard>
      <SettingsHint>
        Implement starts coding as soon as a ticket is assigned and opens a PR
        when done. Plan runs a planning interview first. Ask waits for you to
        choose.
      </SettingsHint>

      <SettingsGroupLabel>Model routing</SettingsGroupLabel>
      <SettingCard>
        <div className="flex flex-col gap-3 p-3">
          {rules.length === 0 && (
            <span className="text-faint text-body">
              No label rules yet. Add one to run matching issues on a specific
              model.
            </span>
          )}
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="w-40"
                placeholder="label (e.g. opus)"
                value={rule.label}
                onChange={(e) => setRule(i, { label: e.target.value })}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <span className="text-faint">→</span>
              <OptionSelect
                label="Model"
                className="grow"
                value={rule.model}
                options={modelChoices}
                onChange={(v) => setRule(i, { model: v })}
              />
              <Button
                type="button"
                variant="ghost"
                aria-label="Remove rule"
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                icon={<IconTrash size={16} />}
              />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              variant="default"
              size="sm"
              icon={<IconPlus size={15} />}
              onClick={() =>
                setRules((rs) => [...rs, { label: "", model: "" }])
              }
            >
              Add rule
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-dim text-body">Fallback</span>
              <OptionSelect
                label="Fallback model"
                className="w-56"
                value={fallback}
                options={fallbackChoices}
                onChange={setFallback}
              />
            </div>
          </div>
          {error && <InlineAlert>{error}</InlineAlert>}
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SettingCard>
      <SettingsHint>
        A label match wins over the fallback; an issue matching nothing uses the
        fallback (or the global default if none is set). Labels are matched
        case-insensitively.
      </SettingsHint>

      <SettingsGroupLabel className="mt-9">
        GitHub App repositories
      </SettingsGroupLabel>
      <SettingCard>
        <div className="flex flex-col gap-2 p-3">
          {appError && <InlineAlert>{appError}</InlineAlert>}
          {appRepos === null && !appError && (
            <span className="text-faint text-body">Loading…</span>
          )}
          {appRepos?.length === 0 && (
            <span className="text-faint text-body">
              No repositories reachable by the GitHub App.
            </span>
          )}
          {appRepos?.map((r) => {
            const isReg = registered.has(r.fullName.toLowerCase());
            return (
              <div
                key={r.fullName}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate font-mono text-body">
                  {r.fullName}
                </span>
                {isReg ? (
                  <Badge>Registered</Badge>
                ) : (
                  <span className="text-faint text-caption">
                    Not registered
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </SettingCard>
      <SettingsHint>
        Only <strong>registered</strong> repositories are Linear routing
        targets. Register one in Setup → Repositories, then set its labels from
        that repo&rsquo;s ⋯ → Linear routing.
      </SettingsHint>
    </SettingsPanel>
  );
}

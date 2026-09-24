import { useCallback, useEffect, useState } from "react";
import {
  fetchUpdateSettings,
  saveUpdateSettings,
  type UpdateSettingsDto,
} from "../../lib/api";
import { errorMessage } from "../../lib/error-message";
import { Button } from "../../ui/button";
import {
  SettingCard,
  SettingCardSkeleton,
  SettingRow,
  SettingRowControl,
  SettingRowDescription,
  SettingRowText,
  SettingRowTitle,
  SettingsHeader,
  SettingsHint,
  SettingsPanel,
  settingsInputClass,
} from "../../ui/settings";
import { InlineAlert } from "../../ui/state";
import { toast } from "../../ui/toast";
import { cn } from "../../ui/cn";

/** The canonical upstream project's release base. A source that is not this is
 *  a fork or mirror, which the CLI updater flags before it proceeds. */
const UPSTREAM_RELEASE_BASE =
  "https://github.com/tellahq/opensession/releases/latest/download";

function isUpstream(base: string): boolean {
  return /^https:\/\/github\.com\/tellahq\/opensession\/releases\//.test(
    base.trim(),
  );
}

/**
 * Where this instance downloads releases from. Pre-populated with the source
 * recorded at install time (config.releaseBase); saving it is what
 * `opensession update` follows. Empty means the built-in default.
 */
export function UpdatesPanel() {
  const [settings, setSettings] = useState<UpdateSettingsDto | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const dto = await fetchUpdateSettings();
      setSettings(dto);
      setDraft(dto.releaseBase);
    } catch (error) {
      setLoadError(errorMessage(error, "Couldn’t load update settings"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const effective = draft.trim() || settings?.releaseBase.trim() || "";
  const nonUpstream = !isUpstream(effective || "");
  const dirty =
    settings != null && draft.trim() !== settings.releaseBase.trim();

  async function save() {
    setBusy(true);
    try {
      const dto = await saveUpdateSettings({ releaseBase: draft.trim() });
      setSettings(dto);
      setDraft(dto.releaseBase);
      toast("Update source saved.");
    } catch (error) {
      toast(errorMessage(error, "Couldn’t save update source"), {
        variant: "error",
      });
    }
    setBusy(false);
  }

  return (
    <SettingsPanel>
      <SettingsHeader
        title="Updates"
        description="Where this instance downloads releases from."
      />
      {loadError && !settings ? (
        <InlineAlert onRetry={() => void load()}>{loadError}</InlineAlert>
      ) : !settings ? (
        <SettingCard>
          <SettingCardSkeleton rows={2} label="Loading update settings" />
        </SettingCard>
      ) : (
        <>
          <SettingCard>
            <SettingRow>
              <SettingRowText>
                <SettingRowTitle>Update source</SettingRowTitle>
                <SettingRowDescription>
                  The release download base <code>opensession update</code>{" "}
                  follows. Leave blank to use the built-in default.
                </SettingRowDescription>
              </SettingRowText>
              <SettingRowControl className="flex flex-wrap items-center justify-end gap-2">
                <input
                  className={cn(settingsInputClass, "w-[320px] max-w-full")}
                  value={draft}
                  disabled={busy}
                  placeholder={UPSTREAM_RELEASE_BASE}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && dirty && !busy) void save();
                    else if (event.key === "Escape")
                      setDraft(settings.releaseBase);
                  }}
                  aria-label="Update source"
                />
                <Button
                  variant="primary"
                  disabled={!dirty || busy}
                  onClick={() => void save()}
                >
                  Save
                </Button>
              </SettingRowControl>
            </SettingRow>
          </SettingCard>
          {nonUpstream && (
            <InlineAlert variant="warn" title="Non-upstream update source">
              Updates come from a fork or mirror, not the upstream project.{" "}
              <code>opensession update</code> reports this and needs{" "}
              <code>--yes</code> to proceed.
            </InlineAlert>
          )}
          <SettingsHint>
            The <code>OPENSESSION_RELEASE_BASE</code> environment variable
            overrides this value. Recorded at install time from where the box
            was installed; config file: <code>{settings.configPath}</code>.
          </SettingsHint>
        </>
      )}
    </SettingsPanel>
  );
}

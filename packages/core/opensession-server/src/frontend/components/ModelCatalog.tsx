import { useEffect, useMemo, useState } from "react";
import { BASE_PATH } from "../lib/base";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InlineAlert, LoadingState } from "../ui/state";
import {
  SettingCard,
  SettingsGroupLabel,
  SettingsHint,
  settingsInputClass,
} from "../ui/settings";
import { IconSearch } from "./icons";
import { toast } from "../ui/toast";
import { errorMessage } from "../lib/error-message";

interface CatalogRow {
  id: string;
  name: string;
  reasoning?: boolean;
  contextWindow?: number;
  cost?: { input: number; output: number };
  inPicker: boolean;
}

// Rendering hundreds of rows at once is pointless clutter; the search is how
// you find a model in a 400-row catalog, so cap the drawn list and nudge to
// refine rather than paint everything.
const RENDER_CAP = 1000;

/** A provider's full catalog: browse/search/filter and toggle which models are
 *  in the picker allowlist (what every model picker shows). Reached from the
 *  provider row's "Manage models". */
export function ModelCatalog({
  providerId,
  onBack,
  onChanged,
}: {
  providerId: string;
  onBack: () => void;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyReasoning, setOnlyReasoning] = useState(false);
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch(
      `${BASE_PATH}/api/settings/model-providers/${encodeURIComponent(
        providerId,
      )}/catalog`,
    )
      .then((r) => r.json())
      .then((d: { rows?: CatalogRow[] }) => setRows(d.rows ?? []))
      .catch((e) => setError(errorMessage(e, "Couldn't load the catalog")));
  }, [providerId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!needle ||
          r.id.toLowerCase().includes(needle) ||
          (r.name || "").toLowerCase().includes(needle)) &&
        (!onlyReasoning || r.reasoning) &&
        (!onlyPicked || r.inPicker),
    );
  }, [rows, query, onlyReasoning, onlyPicked]);

  const pickedCount = (rows ?? []).filter((r) => r.inPicker).length;

  async function toggle(row: CatalogRow, next: boolean) {
    setBusy(row.id);
    setRows(
      (rs) =>
        rs?.map((r) => (r.id === row.id ? { ...r, inPicker: next } : r)) ?? rs,
    );
    const res = await fetch(
      `${BASE_PATH}/api/settings/model-providers/${encodeURIComponent(
        providerId,
      )}/picker`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: row.id, inPicker: next }),
      },
    ).catch(() => null);
    if (res && res.ok) {
      onChanged?.();
    } else {
      // Roll the optimistic flip back and surface the reason.
      setRows(
        (rs) =>
          rs?.map((r) => (r.id === row.id ? { ...r, inPicker: !next } : r)) ??
          rs,
      );
      const body = res ? await res.json().catch(() => null) : null;
      toast(body?.error || "Failed to update the picker", { variant: "error" });
    }
    setBusy(null);
  }

  // Select all / Clear all over the CURRENT filter, in one request — so
  // "reasoning models only → Select all" is easy on a 400-row gateway.
  async function bulk(next: boolean) {
    const targetIds = filtered.map((r) => r.id);
    if (!targetIds.length) return;
    setBusy("__bulk__");
    const prev = rows;
    const set = new Set(targetIds);
    setRows(
      (rs) =>
        rs?.map((r) => (set.has(r.id) ? { ...r, inPicker: next } : r)) ?? rs,
    );
    const res = await fetch(
      `${BASE_PATH}/api/settings/model-providers/${encodeURIComponent(
        providerId,
      )}/picker/bulk`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: targetIds, inPicker: next }),
      },
    ).catch(() => null);
    if (res && res.ok) {
      onChanged?.();
      toast(
        next
          ? `Added ${targetIds.length} to the picker`
          : `Removed ${targetIds.length} from the picker`,
      );
    } else {
      setRows(prev ?? null);
      const body = res ? await res.json().catch(() => null) : null;
      toast(body?.error || "Bulk update failed", { variant: "error" });
    }
    setBusy(null);
  }

  return (
    <>
      <SettingsGroupLabel
        actions={
          <Button size="sm" variant="ghost" onClick={onBack}>
            Done
          </Button>
        }
      >
        {providerId} ·{" "}
        {rows
          ? `${rows.length} model${rows.length === 1 ? "" : "s"} · ${pickedCount} in picker`
          : "…"}
      </SettingsGroupLabel>

      <div className="mb-2 flex items-center gap-3">
        <div className="relative grow">
          <IconSearch
            size={15}
            className="text-faint pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
          />
          <input
            className={`${settingsInputClass} pl-7`}
            placeholder="Search models…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <label className="text-dim flex items-center gap-1.5 text-body">
          <Checkbox
            checked={onlyReasoning}
            onCheckedChange={(v) => setOnlyReasoning(!!v)}
          />
          Reasoning
        </label>
        <label className="text-dim flex items-center gap-1.5 text-body">
          <Checkbox
            checked={onlyPicked}
            onCheckedChange={(v) => setOnlyPicked(!!v)}
          />
          In picker
        </label>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-faint text-caption">{filtered.length} shown</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={busy !== null || filtered.length === 0}
            onClick={() => void bulk(true)}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={busy !== null || filtered.length === 0}
            onClick={() => void bulk(false)}
          >
            Clear all
          </Button>
        </div>
      </div>

      <SettingCard>
        {error && <InlineAlert>{error}</InlineAlert>}
        {!rows && !error && (
          <LoadingState placement="row">Loading catalog…</LoadingState>
        )}
        {rows && (
          <div className="flex max-h-[55vh] flex-col overflow-y-auto overscroll-contain px-3">
            {filtered.slice(0, RENDER_CAP).map((r) => (
              <div
                key={r.id}
                className="border-divider flex items-center justify-between gap-3 border-b py-2 last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-body">{r.id}</div>
                  {r.contextWindow ? (
                    <div className="text-faint text-caption">
                      {Math.round(r.contextWindow / 1000)}k ctx
                      {r.reasoning ? " · reasoning" : ""}
                    </div>
                  ) : null}
                </div>
                <Checkbox
                  checked={r.inPicker}
                  disabled={busy === r.id}
                  onCheckedChange={(v) => void toggle(r, !!v)}
                />
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-faint py-3 text-body">No models match.</div>
            )}
            {filtered.length > RENDER_CAP && (
              <div className="text-faint py-2 text-caption">
                Showing {RENDER_CAP} of {filtered.length}. Refine your search.
              </div>
            )}
          </div>
        )}
      </SettingCard>
      <SettingsHint>
        Models you enable here appear in every picker (composer, Linear routing,
        workspace presets). Discovery fills this catalog; you choose
        what&rsquo;s selectable.
      </SettingsHint>
    </>
  );
}

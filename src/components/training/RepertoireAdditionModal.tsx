import {
  Alert,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useAtomValue, useStore } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { tabsAtom } from "@/state/atoms";
import { trainingAreasAtom } from "@/state/trainingAreas";
import {
  createDebouncedSessionStorage,
  getLatestSessionStorageValue,
} from "@/state/store/debouncedStorage";
import { parsePGN } from "@/utils/chess";
import {
  parseRecordSelection,
  prepareRepertoireAddition,
  selectRepertoireTree,
  type AdditionMode,
  type AdditionSource,
} from "@/utils/repertoireAddition";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import { commitRepertoireAddition } from "@/utils/commitRepertoireAddition";
import type { OpeningsState } from "@/utils/trainingAreas";
import type { TreeState } from "@/utils/treeReducer";
import { unwrap } from "@/utils/unwrap";

type Preview = ReturnType<typeof prepareRepertoireAddition> & {
  baseline: string;
  openings: OpeningsState;
};

export default function RepertoireAdditionModal({
  onClose,
  tree,
  treeSource,
  initialRepertoireId = "",
  initialVariantId = "",
}: {
  onClose: () => void;
  tree?: TreeState;
  treeSource?: AdditionSource;
  initialRepertoireId?: string;
  initialVariantId?: string;
}) {
  const { t } = useTranslation();
  const areas = useAtomValue(trainingAreasAtom);
  const atomStore = useStore();
  const [repertoireId, setRepertoireId] = useState(initialRepertoireId);
  const [variantId, setVariantId] = useState(initialVariantId);
  const [mode, setMode] = useState<AdditionMode>("theory");
  const [scope, setScope] = useState<"line" | "subtree">("line");
  const [path, setPath] = useState("");
  const [selection, setSelection] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const repertoire = areas.openings.repertoires[repertoireId];
  const variants =
    repertoire?.variantIds
      .map((id) => areas.openings.variants[id])
      .filter((variant) => variant?.contentType === "theory") ?? [];

  function ensureNoDirtyTargets() {
    for (const tab of atomStore.get(tabsAtom)) {
      if (
        getTabFile(tab)?.path === repertoire?.path &&
        getLatestSessionStorageValue<TreeState>(tab.value)?.state.dirty
      ) {
        throw new Error(
          t(
            "Repertoire.UnsavedTarget",
            "Save or discard unsaved changes in this repertoire's tabs before importing.",
          ),
        );
      }
    }
  }

  async function inspect() {
    if (!repertoire) return;
    setBusy(true);
    setError("");
    try {
      ensureNoDirtyTargets();
      const baseline = await readTextFile(repertoire.path);
      const count = unwrap(await commands.countPgnGames(repertoire.path));
      if (count === 0)
        throw new Error(
          t("Repertoire.Changed", "The repertoire has changed. Close this preview and try again."),
        );
      const records = await Promise.all(
        unwrap(await commands.readGames(repertoire.path, 0, count - 1)).map((raw) => parsePGN(raw)),
      );
      if (records.length !== repertoire.variantIds.length)
        throw new Error(
          t("Repertoire.Changed", "The repertoire has changed. Close this preview and try again."),
        );
      let incoming: TreeState[];
      let indexes: number[];
      if (tree) {
        incoming = [
          {
            ...tree,
            root: selectRepertoireTree(
              tree.root,
              tree.position,
              mode === "modelGame" ? "game" : scope,
            ),
          },
        ];
        indexes = treeSource?.recordIndexes ?? [0];
      } else {
        const sourceCount = unwrap(await commands.countPgnGames(path));
        indexes = parseRecordSelection(selection, sourceCount);
        incoming = [];
        for (let offset = 0; offset < indexes.length; ) {
          const first = indexes[offset++];
          let last = first;
          while (offset < indexes.length && indexes[offset] === last + 1) last = indexes[offset++];
          // Read contiguous selections in one scan, including the common "all records" case.
          const rawRecords = unwrap(await commands.readGames(path, first, last));
          if (rawRecords.length !== last - first + 1)
            throw new Error(
              t(
                "Repertoire.Changed",
                "The repertoire has changed. Close this preview and try again.",
              ),
            );
          for (const raw of rawRecords) incoming.push(await parsePGN(raw));
        }
      }
      const openings = atomStore.get(trainingAreasAtom).openings;
      setPreview({
        ...prepareRepertoireAddition({
          state: openings,
          repertoireId,
          variantId,
          records,
          incoming,
          mode,
          name,
          source: {
            label: tree
              ? (treeSource?.label ?? t("Repertoire.AnalysisSource", "Analysis board"))
              : path,
            recordIndexes: indexes,
          },
        }),
        baseline,
        openings,
      });
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || !repertoire) return;
    setBusy(true);
    setError("");
    try {
      await commitRepertoireAddition({
        path: repertoire.path,
        baseline: preview.baseline,
        pgn: preview.pgn,
        assertUnchanged: () => {
          ensureNoDirtyTargets();
          if (atomStore.get(trainingAreasAtom).openings !== preview.openings) {
            throw new Error(
              t(
                "Repertoire.Changed",
                "The repertoire has changed. Close this preview and try again.",
              ),
            );
          }
        },
      });
      const tabs = atomStore.get(tabsAtom);
      for (const tab of tabs) {
        if (getTabFile(tab)?.path !== repertoire.path) continue;
        const record = preview.records[getTabGameNumber(tab)];
        if (!record) continue;
        const current = getLatestSessionStorageValue<TreeState>(tab.value)?.state;
        await createDebouncedSessionStorage().removeItem(tab.value);
        sessionStorage.setItem(
          tab.value,
          JSON.stringify({
            version: 0,
            state: { ...record, dirty: false, position: current?.position ?? [] },
          }),
        );
      }
      atomStore.set(trainingAreasAtom, (current) => ({ ...current, openings: preview.state }));
      atomStore.set(tabsAtom, (current) =>
        current.map((tab) =>
          getTabFile(tab)?.path === repertoire.path
            ? {
                ...tab,
                revision: (tab.revision ?? 0) + 1,
                gameOrigin:
                  tab.gameOrigin.kind === "file" || tab.gameOrigin.kind === "temp_file"
                    ? {
                        ...tab.gameOrigin,
                        file: { ...tab.gameOrigin.file, numGames: preview.records.length },
                      }
                    : tab.gameOrigin,
              }
            : tab,
        ),
      );
      // Native reads use a sparse byte-offset cache. Rebuild it after replacing the PGN.
      const refreshed = await commands.countPgnGames(repertoire.path);
      if (refreshed.status === "error") {
        setPreview(null);
        throw new Error(
          t(
            "Repertoire.SavedRefreshFailed",
            "The import was saved, but the file index could not be refreshed. Close and reopen the app before opening this repertoire.",
          ),
        );
      }
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened
      onClose={() => !busy && onClose()}
      title={t("Repertoire.AddContent", "Add to repertoire")}
      size="lg"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack>
        <Alert color="blue">
          {t(
            "Repertoire.ImportPolicy",
            "Only the editable copy changes. Matching moves are merged; comments are preserved. Different move orders stay separate. The repertoire's training color is kept. A recovery PGN is saved before importing.",
          )}
        </Alert>
        {error && <Alert color="red">{error}</Alert>}
        <Select
          label={t("Repertoire.Target", "Repertoire")}
          value={repertoireId}
          disabled={busy || !!preview}
          data={Object.values(areas.openings.repertoires).map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          onChange={(value) => {
            setRepertoireId(value ?? "");
            setVariantId("");
          }}
        />
        <SegmentedControl
          value={mode}
          disabled={busy || !!preview}
          onChange={(value) => setMode(value as AdditionMode)}
          data={[
            { value: "theory", label: t("Repertoire.Theory", "Theory lines") },
            { value: "modelGame", label: t("Repertoire.ModelGames", "Model games") },
          ]}
        />
        {mode === "theory" ? (
          <Select
            label={t("Repertoire.Variant", "Variant / folder")}
            value={variantId}
            disabled={busy || !!preview}
            data={variants.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => setVariantId(value ?? "")}
          />
        ) : (
          <TextInput
            label={t("Repertoire.GameName", "Model game name (optional)")}
            value={name}
            disabled={busy || !!preview}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        )}
        {tree ? (
          mode === "theory" && (
            <SegmentedControl
              value={scope}
              disabled={busy || !!preview}
              onChange={(value) => setScope(value as typeof scope)}
              data={[
                { value: "line", label: t("Repertoire.SelectedLine", "Line up to selected move") },
                {
                  value: "subtree",
                  label: t("Repertoire.SelectedTree", "Selected branch and continuations"),
                },
              ]}
            />
          )
        ) : (
          <>
            <Button
              variant="default"
              disabled={busy || !!preview}
              onClick={async () => {
                const selected = await open({
                  multiple: false,
                  filters: [{ name: "PGN", extensions: ["pgn"] }],
                });
                if (typeof selected === "string") {
                  setPath(selected);
                  setSelection("");
                }
              }}
            >
              {t("Repertoire.SelectPgn", "Select PGN file")}
            </Button>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              {path}
            </Text>
            <TextInput
              label={t("Repertoire.Records", "Records (empty = all)")}
              placeholder="1, 3-5"
              value={selection}
              disabled={busy || !!preview}
              onChange={(event) => setSelection(event.currentTarget.value)}
            />
          </>
        )}
        {preview && (
          <Alert color="teal">
            {t(
              "Repertoire.PreviewSummary",
              "New lines: {{lines}} · matching lines: {{duplicates}} · new model games: {{games}}",
              {
                lines: preview.addedLines,
                duplicates: preview.duplicateLines,
                games: preview.addedGames,
              },
            )}
          </Alert>
        )}
        <Group justify="flex-end">
          {preview && (
            <Button variant="default" disabled={busy} onClick={() => setPreview(null)}>
              {t("Common.Back", "Back")}
            </Button>
          )}
          <Button
            loading={busy}
            disabled={!repertoire || (!tree && !path) || (mode === "theory" && !variantId)}
            onClick={() => void (preview ? commit() : inspect())}
          >
            {preview
              ? t("Repertoire.ConfirmImport", "Confirm import")
              : t("Repertoire.Preview", "Preview")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useLoaderData } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { tabsAtom } from "@/state/atoms";
import { saveToFile, type Tab } from "@/utils/tabs";
import { TreeStateContext } from "../common/TreeStateContext";

function ConfirmChangesModal({
  opened,
  toggle,
  closeTab,
  tab,
}: {
  opened: boolean;
  toggle: () => void;
  closeTab: () => void;
  tab: Tab;
}) {
  const setTabs = useSetAtom(tabsAtom);
  const store = useContext(TreeStateContext)!;
  const { documentDir } = useLoaderData({ from: "/" });
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAndClose() {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveToFile({
        dir: documentDir,
        setCurrentTab: (update) =>
          setTabs((tabs) =>
            tabs.map((candidate) =>
              candidate.value === tab.value
                ? typeof update === "function"
                  ? update(candidate)
                  : update
                : candidate,
            ),
          ),
        tab,
        store,
        isUserSave: true,
      });
      if (saved) {
        closeTab();
        toggle();
      }
    } catch (error) {
      setError(String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      withCloseButton={false}
      opened={opened}
      onClose={() => !saving && toggle()}
      closeOnEscape={!saving}
      closeOnClickOutside={!saving}
    >
      <Stack>
        <div>
          <Text fz="lg" fw="bold" mb={10}>
            {t("Tabs.UnsavedChanges", "Unsaved changes")}
          </Text>
          <Text>
            {t("Tabs.SaveBeforeClosing", "Do you want to save your changes before closing?")}
          </Text>
        </div>
        {error && (
          <Text c="red" size="sm">
            {t("Tabs.SaveFailed", "Could not save. The tab remains open.")} {error}
          </Text>
        )}

        <Group justify="right">
          <Button variant="subtle" disabled={saving} onClick={toggle}>
            {t("Common.Cancel", "Cancel")}
          </Button>
          <Button
            variant="default"
            disabled={saving}
            onClick={() => {
              closeTab();
              toggle();
            }}
          >
            {t("Tabs.CloseWithoutSaving", "Close without saving")}
          </Button>
          <Button loading={saving} onClick={() => void saveAndClose()}>
            {t("Tabs.SaveAndClose", "Save and close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default ConfirmChangesModal;

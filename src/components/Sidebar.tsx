"use no memo";
import { AppShellSection, Divider, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import {
  type Icon,
  IconChess,
  IconCpu,
  IconDatabase,
  IconFileImport,
  IconFiles,
  IconFlask,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlayerPlay,
  IconSettings,
  IconTarget,
  IconUser,
} from "@tabler/icons-react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import cx from "clsx";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { useBoardShellActions } from "@/hooks/useBoardShellActions";
import { sidebarExpandedAtom } from "@/state/atoms";
import classes from "./Sidebar.module.css";

interface NavbarLinkProps {
  icon: Icon;
  label: string;
  url: string;
  expanded: boolean;
}

function NavContent({ icon: Icon, label, expanded }: Omit<NavbarLinkProps, "url">) {
  return (
    <>
      <Icon size="1.35rem" stroke={1.5} className={classes.icon} />
      {expanded && (
        <Text size="sm" truncate>
          {label}
        </Text>
      )}
    </>
  );
}

function NavbarLink({ url, icon, label, expanded }: NavbarLinkProps) {
  const match = useMatchRoute();
  return (
    <Tooltip label={label} position="right" disabled={expanded}>
      <Link
        to={url}
        aria-label={label}
        className={cx(classes.link, {
          [classes.active]: match({ to: url, fuzzy: url !== "/" }) !== false,
          [classes.expanded]: expanded,
        })}
      >
        <NavContent icon={icon} label={label} expanded={expanded} />
      </Link>
    </Tooltip>
  );
}

function NavbarAction({
  icon,
  label,
  expanded,
  onClick,
}: {
  icon: Icon;
  label: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} position="right" disabled={expanded}>
      <UnstyledButton
        type="button"
        aria-label={label}
        className={cx(classes.link, classes.action, { [classes.expanded]: expanded })}
        onClick={onClick}
      >
        <NavContent icon={icon} label={label} expanded={expanded} />
      </UnstyledButton>
    </Tooltip>
  );
}

export function SideBar() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useAtom(sidebarExpandedAtom);
  const { startGame, importGame, openLaboratory } = useBoardShellActions();

  return (
    <>
      <AppShellSection grow>
        <Stack gap={2} py="xs">
          <NavbarLink
            icon={IconChess}
            label={t("SideBar.Board", "Board")}
            url="/"
            expanded={expanded}
          />
          <NavbarAction
            icon={IconPlayerPlay}
            label={t("SideBar.Play", "Play")}
            expanded={expanded}
            onClick={() => void startGame()}
          />
          <NavbarAction
            icon={IconFileImport}
            label={t("SideBar.Import", "Import")}
            expanded={expanded}
            onClick={() => void importGame()}
          />
          <NavbarLink
            icon={IconTarget}
            label={t("SideBar.Training", "Training")}
            url="/training"
            expanded={expanded}
          />
          <Divider my={4} />
          <NavbarLink
            icon={IconFiles}
            label={t("SideBar.Files", "Files")}
            url="/files"
            expanded={expanded}
          />
          <NavbarLink
            icon={IconDatabase}
            label={t("SideBar.Databases", "Databases")}
            url="/databases"
            expanded={expanded}
          />
          <NavbarLink
            icon={IconCpu}
            label={t("SideBar.Engines", "Engines")}
            url="/engines"
            expanded={expanded}
          />
          <NavbarLink
            icon={IconUser}
            label={t("SideBar.User", "Accounts")}
            url="/accounts"
            expanded={expanded}
          />
          <Divider my={4} />
          <NavbarAction
            icon={IconFlask}
            label={t("SideBar.Laboratory", "Laboratory")}
            expanded={expanded}
            onClick={() => void openLaboratory()}
          />
        </Stack>
      </AppShellSection>
      <AppShellSection>
        <Stack gap={2} pb="xs">
          <NavbarLink
            icon={IconSettings}
            label={t("SideBar.Settings")}
            url="/settings"
            expanded={expanded}
          />
          <NavbarAction
            icon={expanded ? IconLayoutSidebarLeftCollapse : IconLayoutSidebarLeftExpand}
            label={t(expanded ? "SideBar.Collapse" : "SideBar.Expand")}
            expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          />
        </Stack>
      </AppShellSection>
    </>
  );
}

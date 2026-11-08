"use client";

import { getLauncherChips, type LauncherToolId } from "@/lib/tools-launcher";

import { LauncherIcon } from "./tools-launcher";

type Props = {
  isAdmin: boolean;
  onSelectTool: (id: LauncherToolId) => void;
  onOpenAllTools: () => void;
};

/** Shortcut chips to the most important tools, shown while the Fred conversation is still empty. */
export default function EmptyChatToolChips({ isAdmin, onSelectTool, onOpenAllTools }: Props) {
  const chips = getLauncherChips(isAdmin);

  return (
    <div className="empty-chat-tool-chips" role="group" aria-label="Werkzeuge">
      {chips.map(({ tool, tone }) => (
        <button
          key={tool.id}
          className="empty-chat-tool-chip"
          type="button"
          onClick={() => onSelectTool(tool.id)}
        >
          <span className={`empty-chat-tool-chip-icon tone-${tone}`}>
            <LauncherIcon name={tool.icon} size={16} />
          </span>
          {tool.label}
        </button>
      ))}
      <button className="empty-chat-tool-chip is-all" type="button" onClick={onOpenAllTools}>
        Alle Werkzeuge
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
      </button>
    </div>
  );
}

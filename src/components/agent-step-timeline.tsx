import type { AgentStep } from "@/lib/agent-steps";
import {
  agentStepDisplayLabel,
  agentStepIconKind,
  type AgentStepIconKind,
} from "@/lib/agent-step-display";

function AgentStepIcon({ kind }: { kind: AgentStepIconKind }) {
  const sharedProps = {
    "aria-hidden": true,
    className: "agent-step-icon",
    fill: "none",
    focusable: "false" as const,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.5,
    viewBox: "0 0 24 24",
  };

  if (kind === "database-ready") {
    return (
      <svg {...sharedProps}>
        <ellipse cx="12" cy="5.5" rx="7.25" ry="2.75" />
        <path d="M4.75 5.5v5c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75v-5" />
        <path d="M4.75 10.5v5c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75v-5" />
      </svg>
    );
  }

  if (kind === "database-search") {
    return (
      <svg {...sharedProps}>
        <ellipse cx="9.5" cy="5.25" rx="6.25" ry="2.25" />
        <path d="M3.25 5.25v4.5C3.25 11 6.05 12 9.5 12c1.14 0 2.2-.11 3.1-.31" />
        <path d="M3.25 9.75v4.5c0 1.25 2.8 2.25 6.25 2.25" />
        <circle cx="16.25" cy="15.25" r="3.25" />
        <path d="m18.65 17.65 2.1 2.1" />
      </svg>
    );
  }

  if (kind === "document-search") {
    return (
      <svg {...sharedProps}>
        <path d="M5.5 3.25h7l4 4v4.25" />
        <path d="M12.5 3.25v4h4" />
        <path d="M12 20.25H5.5v-17" />
        <circle cx="16.25" cy="15.75" r="3.25" />
        <path d="m18.65 18.15 2.1 2.1" />
      </svg>
    );
  }

  if (kind === "download") {
    return (
      <svg {...sharedProps}>
        <path d="M6 3.25h7l4 4v3" />
        <path d="M13 3.25v4h4" />
        <path d="M10 20.25H6v-17" />
        <path d="M15.5 11.5v7" />
        <path d="m12.75 15.75 2.75 2.75 2.75-2.75" />
      </svg>
    );
  }

  if (kind === "plan") {
    return (
      <svg {...sharedProps}>
        <path d="M9.5 5h10M9.5 12h10M9.5 19h10" />
        <path d="m3.5 5 1.5 1.5L7.5 4M3.5 12 5 13.5 7.5 11M3.5 19 5 20.5 7.5 18" />
      </svg>
    );
  }

  if (kind === "warning") {
    return (
      <svg {...sharedProps}>
        <path d="M10.15 4.1 2.9 17.25A2 2 0 0 0 4.65 20h14.7a2 2 0 0 0 1.75-2.75L13.85 4.1a2.1 2.1 0 0 0-3.7 0Z" />
        <path d="M12 8.5v5" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  if (kind === "verification") {
    return (
      <svg {...sharedProps}>
        <path d="M12 3.25 19 6v5.25c0 4.5-2.8 7.65-7 9.5-4.2-1.85-7-5-7-9.5V6l7-2.75Z" />
        <path d="m8.75 12 2.1 2.1 4.4-4.4" />
      </svg>
    );
  }

  if (kind === "compose") {
    return (
      <svg {...sharedProps}>
        <path d="m5 16.75-.75 3 3-.75L17.5 8.75l-2.25-2.25L5 16.75Z" />
        <path d="m13.75 8 2.25 2.25" />
        <path d="M19 3.25v3M17.5 4.75h3" />
      </svg>
    );
  }

  return (
    <svg {...sharedProps}>
      <path d="M8.1 14.75c-1.35-1.1-2.2-2.8-2.2-4.7A6.1 6.1 0 0 1 12 3.95a6.1 6.1 0 0 1 6.1 6.1c0 1.9-.85 3.6-2.2 4.7-.8.65-1.15 1.3-1.25 2.05h-5.3c-.1-.75-.45-1.4-1.25-2.05Z" />
      <path d="M9.5 19.25h5M10.5 21h3" />
    </svg>
  );
}

export default function AgentStepTimeline({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className="agent-progress-list" aria-label="Rechercheverlauf" role="list">
      {steps.map((step, index) => {
        const iconKind = agentStepIconKind(step);
        const isFailure = step.type === "tool_result" && !step.success;
        return (
          <li
            className={`agent-progress-step${isFailure ? " is-failure" : ""}${step.type === "answer" ? " is-answer" : ""}`}
            key={`${step.type}-${index}`}
          >
            <span className="agent-step-marker" aria-hidden="true">
              <AgentStepIcon kind={iconKind} />
            </span>
            <span className="agent-step-label">{agentStepDisplayLabel(step)}</span>
          </li>
        );
      })}
    </ol>
  );
}

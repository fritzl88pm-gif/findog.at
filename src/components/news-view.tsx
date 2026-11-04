import type { DashboardNewsItem } from "@/lib/dashboard";

import { NewsSection } from "./news-section";

type Props = {
  items: DashboardNewsItem[];
  error?: string;
  isLoading: boolean;
};

/** "Neuigkeiten": the platform updates formerly shown on the dashboard. */
export default function NewsView({ items, error, isLoading }: Props) {
  return (
    <section className="dashboard-panel" aria-labelledby="news-view-title">
      <div className="dashboard-view">
        <NewsSection
          id="news-view-title"
          title="Neuigkeiten"
          subtitle="Neuigkeiten und Hinweise zur Plattform"
          headingLevel="h1"
          items={items}
          error={error || undefined}
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}

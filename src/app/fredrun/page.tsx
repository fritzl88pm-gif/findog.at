import { notFound } from "next/navigation";

import FredRunView from "@/components/fredrun-view";

export default function LocalFredrunPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main style={{ minHeight: "100vh", padding: "clamp(10px, 3vw, 28px)", background: "#edf5f8" }}>
      <FredRunView accessToken="" standalone />
    </main>
  );
}

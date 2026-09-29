import type { Metadata, Viewport } from "next";

import FredRun2 from "@/components/fredrun2/FredRun2";

export const metadata: Metadata = {
  title: "Fredrun 2.0",
  description: "Der Endlos-Runner mit sechs Welten, fünf Helden und Highscore.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#05060f",
  viewportFit: "cover",
};

export default function FredRun2Page() {
  return <FredRun2 />;
}

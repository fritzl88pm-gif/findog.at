import type { Metadata, Viewport } from "next";

import FredRun2 from "@/components/fredrun2/FredRun2";

export const metadata: Metadata = {
  metadataBase: new URL("https://findog.at"),
  title: "Fredrun 2.0",
  description: "Der Endlos-Runner mit sechs Welten, fünf Helden und Highscore.",
  openGraph: {
    title: "Fredrun 2.0",
    description: "Der Endlos-Runner mit sechs Welten, fünf Helden und Highscore.",
    images: [{ url: "/fredrun2/logo-sm.webp", width: 971, height: 650, alt: "Fredrun 2.0" }],
  },
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

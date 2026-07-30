import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Geteilte Fred-Antwort",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noarchive: true },
  },
};

export default function FredPublicShareNotFound() {
  return (
    <main className="fred-public-share">
      <p className="fred-public-share-text">
        Diese geteilte Fred-Antwort ist nicht mehr verfügbar.
      </p>
    </main>
  );
}

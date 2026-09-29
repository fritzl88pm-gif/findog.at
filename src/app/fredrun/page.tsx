import FredRunView from "@/components/fredrun-view";

export default function FredrunPage() {
  return (
    <main style={{ minHeight: "100vh", padding: "clamp(10px, 3vw, 28px)", background: "#edf5f8" }}>
      <FredRunView accessToken="" standalone />
      <a
        href="/fredrun2"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          padding: "10px 18px",
          borderRadius: 999,
          background: "linear-gradient(180deg, #ffd23f, #f59e0b)",
          color: "#2b1300",
          fontWeight: 900,
          textDecoration: "none",
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          zIndex: 50,
        }}
      >
        Neu: Fredrun 2.0 →
      </a>
    </main>
  );
}

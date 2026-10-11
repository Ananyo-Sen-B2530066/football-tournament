import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Deliberately NOT the event name: this is baked in at build time, while the
  // real name is store state and can change mid-event. useTournament() sets
  // document.title from state once the first poll lands, so a generic default
  // here is correct — a hard-coded event name would go stale silently.
  title: "Tournament Hub",
  description: "Three sites, one server: phone score entry, owner control and a live projection for a LAN tournament",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#060b26] text-white antialiased">{children}</body>
    </html>
  );
}

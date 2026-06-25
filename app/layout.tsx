import type { Metadata } from "next";
import "./globals.css";
import Navigation from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Ekagra Health — Call Center Dashboard",
  description: "Call center operations dashboard for Ekagra Health",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans bg-gray-50 min-h-screen">
        <Navigation />
        <main className="max-w-screen-2xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

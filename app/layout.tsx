import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NodeVelo",
  description: "AI-powered training block generator on top of Intervals.icu.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Nav />
        {/* Reserve space for the fixed right rail on desktop; bottom bar on mobile */}
        <div className="sm:pr-44">
          <main className="mx-auto w-full max-w-5xl px-4 py-5 pb-24 sm:py-8 sm:pb-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

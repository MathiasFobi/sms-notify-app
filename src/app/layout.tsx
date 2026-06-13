import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/cn";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "sms-notify-app",
  description:
    "Production SMS notifications for teams that outgrew the spreadsheet. Send, schedule, and track bulk SMS from a single web app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        geistSans.variable,
        geistMono.variable,
        "h-full antialiased",
      )}
    >
      <body
        className={cn(
          "min-h-full flex flex-col",
          "bg-zinc-50 text-zinc-900 antialiased",
          "dark:bg-zinc-950 dark:text-zinc-50",
        )}
      >
        {children}
      </body>
    </html>
  );
}

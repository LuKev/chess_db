import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess DB",
  description: "Web-based chess database",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


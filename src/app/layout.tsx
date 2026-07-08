import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Las Vegas",
  description: "A testnet jackpot where humans and agents enter with Sphere, and an autonomous vault settles every round."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

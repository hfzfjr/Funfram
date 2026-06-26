import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FunFram - Connect & Play in Real-Time",
  description: "FunFram is a social platform where frames of friends meet random frames in video chat and play interactive drawing games.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

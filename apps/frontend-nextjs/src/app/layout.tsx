import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import CustomAlertModal from '@/components/ui/overlay/CustomAlertModal';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
});

export const viewport: Viewport = {
  themeColor: "#0ea5e9",
};

export const metadata: Metadata = {
  title: "FunFram - Obrolan Video & Mini-Game Seru",
  description: "FunFram adalah platform sosial tempat kamu dan teman bisa bertemu teman baru lewat obrolan video dan 4 mini-game interaktif secara langsung.",
  icons: {
    icon: "/favicon.ico",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "FunFram",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={`antialiased ${plusJakartaSans.variable}`}>
      <body className="antialiased font-sans">
        {children}
        <CustomAlertModal />
      </body>
    </html>
  );
}

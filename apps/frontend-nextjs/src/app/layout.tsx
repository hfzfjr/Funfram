import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import CustomAlertModal from '@/components/ui/overlay/CustomAlertModal';

const plusJakartaSans = Plus_Jakarta_Sans({ 
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
});

export const metadata: Metadata = {
  title: "FunFram - Connect & Play in Real-Time",
  description: "FunFram is a social platform where frames of friends meet random frames in video chat and play interactive drawing games.",
  icons: {
    icon: "/favicon.ico",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Funfram",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${plusJakartaSans.variable}`}>
      <body className="antialiased font-sans">
        {children}
        <CustomAlertModal />
      </body>
    </html>
  );
}

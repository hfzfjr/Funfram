import type { Metadata } from "next";
import "./globals.css";
import CustomAlertModal from '@/components/ui/overlay/CustomAlertModal';

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
      <body className="antialiased font-sans">
        {children}
        <CustomAlertModal />
      </body>
    </html>
  );
}

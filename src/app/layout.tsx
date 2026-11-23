import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  variable: "--font-ibm-plex-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FINORA — Personal Financial Operating System",
  description:
    "ระบบบริหารการเงินส่วนบุคคลแบบบัญชีคู่ (Double-Entry Core) รองรับการทำงานออฟไลน์บน iPhone Safari",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FINORA",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#121715" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${inter.variable} ${ibmPlexSansThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-primary">
        {children}
      </body>
    </html>
  );
}
